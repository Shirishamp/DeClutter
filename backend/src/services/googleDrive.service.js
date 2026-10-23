const { google } = require('googleapis');
const { getGoogleOAuthClient } = require('../config/googleAuth');
const pool = require('../config/db');

/**
 * Builds an authenticated OAuth client for a specific stored account,
 * and keeps the database updated if Google issues a refreshed access token.
 */
async function getAuthClientForAccount(account) {
  if (!account.refresh_token) {
    throw new Error('This Google account has no saved refresh token. Reconnect the account and try again.');
  }

  const oauth2Client = getGoogleOAuthClient();

  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: account.token_expiry ? new Date(account.token_expiry).getTime() : null,
  });

  oauth2Client.on('tokens', (tokens) => {
    const accessToken = tokens.access_token || null;
    const refreshToken = tokens.refresh_token || null;
    const expiryDate =
      Number.isFinite(tokens.expiry_date) && tokens.expiry_date > 0
        ? new Date(tokens.expiry_date)
        : null;

    if (!accessToken && !refreshToken && !expiryDate) {
      return;
    }

    pool
      .query(
        `UPDATE accounts
         SET access_token = COALESCE(?, access_token),
             refresh_token = COALESCE(?, refresh_token),
             token_expiry = COALESCE(?, token_expiry)
         WHERE id = ?`,
        [accessToken, refreshToken, expiryDate, account.id]
      )
      .catch((error) => {
        console.error('Failed to persist refreshed Google OAuth tokens:', error.message);
      });
  });

  return oauth2Client;
}

/**
 * Fetches all files for a given account from Google Drive,
 * resolving each file's immediate parent folder name.
 */
async function fetchDriveFiles(account) {
  const authClient = await getAuthClientForAccount(account);
  const drive = google.drive({ version: 'v3', auth: authClient });

  const folderNameCache = new Map(); // avoid repeat lookups for the same folder
  const allFiles = [];
  let pageToken = null;

  do {
    const response = await drive.files.list({
      pageSize: 100,
      pageToken: pageToken || undefined,
      fields: 'nextPageToken, files(id, name, mimeType, size, parents, modifiedTime)',
      q: 'trashed = false',
    });

    for (const file of response.data.files) {
      const folderPath = await resolveFolderName(drive, file.parents, folderNameCache);

      allFiles.push({
        file_id: file.id,
        file_name: file.name,
        file_type: file.mimeType,
        file_size: file.size ? parseInt(file.size, 10) : null,
        folder_path: folderPath,
        modified_date: file.modifiedTime ? new Date(file.modifiedTime) : null,
      });
    }

    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

/**
 * Builds an Error with a readable message and an HTTP status code
 * so the route can send it straight back to the frontend.
 */
function createCopyError(message, statusCode, googleMessage) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (googleMessage) {
    error.googleMessage = googleMessage;
  }
  return error;
}

/**
 * Copies a file into another connected account without changing the original.
 * The temporary share lets the destination account copy a file it does not own.
 * The file contents never pass through this server: Google copies it internally.
 */
async function copyDriveFile(sourceAccount, destinationAccount, fileId) {
  const sourceAuth = await getAuthClientForAccount(sourceAccount);
  const destinationAuth = await getAuthClientForAccount(destinationAccount);
  const sourceDrive = google.drive({ version: 'v3', auth: sourceAuth });
  const destinationDrive = google.drive({ version: 'v3', auth: destinationAuth });

  const { data: sourceFile } = await sourceDrive.files.get({
    fileId,
    fields:
      'id, name, mimeType, size, modifiedTime, parents, ownedByMe, copyRequiresWriterPermission, capabilities(canShare, canCopy)',
    supportsAllDrives: true,
  });

  if (sourceFile.mimeType === 'application/vnd.google-apps.folder') {
    throw createCopyError('Moving folders between accounts is not supported', 400);
  }

  // Check up front whether Google will allow this, so we can explain clearly.
  if (sourceFile.capabilities && sourceFile.capabilities.canShare === false) {
    throw createCopyError(
      `${sourceAccount.email} is not allowed to share this file, so it cannot be copied to another account. ` +
        'Only files that account owns (or can share) can be copied.',
      403
    );
  }

  if (
    (sourceFile.capabilities && sourceFile.capabilities.canCopy === false) ||
    sourceFile.copyRequiresWriterPermission === true
  ) {
    throw createCopyError(
      'The owner of this file has disabled copying, so it cannot be copied to another account.',
      403
    );
  }

  let permissionId;
  let copiedFile;

  // Step 1: temporary read-only share with the destination account.
  try {
    const { data: permission } = await sourceDrive.permissions.create({
      fileId,
      sendNotificationEmail: false,
      requestBody: {
        type: 'user',
        role: 'reader',
        emailAddress: destinationAccount.email,
      },
      fields: 'id',
      supportsAllDrives: true,
    });
    permissionId = permission.id;
  } catch (error) {
    console.error('Drive share step failed:', error.message);
    throw createCopyError(
      `Google refused to let ${sourceAccount.email} share this file with ${destinationAccount.email}. ` +
        'This usually means the account does not own the file, or its organisation blocks sharing outside the domain.',
      403,
      error.message
    );
  }

  // Step 2: the destination account copies the file into its own Drive.
  try {
    const { data } = await destinationDrive.files.copy({
      fileId,
      requestBody: { name: sourceFile.name, parents: ['root'] },
      fields: 'id, name, mimeType, size, modifiedTime, parents',
      supportsAllDrives: true,
    });
    copiedFile = data;
  } catch (error) {
    try {
      await sourceDrive.permissions.delete({ fileId, permissionId, supportsAllDrives: true });
    } catch (cleanupError) {
      console.error('Failed to remove temporary Drive permission:', cleanupError.message);
    }
    throw error;
  }

  // Step 3: remove the temporary share.
  let permissionCleanupError = null;
  try {
    await sourceDrive.permissions.delete({ fileId, permissionId, supportsAllDrives: true });
  } catch (error) {
    permissionCleanupError = error;
    console.error('Failed to remove temporary Drive permission:', error.message);
  }

  return { sourceFile, copiedFile, permissionCleanupError };
}

/**
 * Moves a file to its owner's Google Drive trash.
 */
async function trashDriveFile(account, fileId) {
  const authClient = await getAuthClientForAccount(account);
  const drive = google.drive({ version: 'v3', auth: authClient });

  const { data } = await drive.files.update({
    fileId,
    requestBody: { trashed: true },
    fields: 'id, name, trashed',
    supportsAllDrives: true,
  });

  return data;
}

/**
 * Fetches an authenticated thumbnail for a file when Google Drive provides one.
 */
async function getDriveFileThumbnail(account, fileId) {
  const authClient = await getAuthClientForAccount(account);
  const drive = google.drive({ version: 'v3', auth: authClient });
  const { data: file } = await drive.files.get({
    fileId,
    fields: 'thumbnailLink',
    supportsAllDrives: true,
  });

  if (!file.thumbnailLink) return null;

  return authClient.request({
    url: file.thumbnailLink,
    responseType: 'stream',
  });
}

/**
 * Resolves the immediate parent folder's name (not a full nested path).
 * Returns "My Drive" if the file has no parent (i.e. it's at the root).
 */
async function resolveFolderName(drive, parents, cache) {
  if (!parents || parents.length === 0) return 'My Drive';

  const parentId = parents[0];
  if (cache.has(parentId)) return cache.get(parentId);

  try {
    const { data } = await drive.files.get({ fileId: parentId, fields: 'name' });
    cache.set(parentId, data.name);
    return data.name;
  } catch (err) {
    cache.set(parentId, 'Unknown Folder');
    return 'Unknown Folder';
  }
}

module.exports = { fetchDriveFiles, copyDriveFile, trashDriveFile, getDriveFileThumbnail };