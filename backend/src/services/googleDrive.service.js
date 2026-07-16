const { google } = require('googleapis');
const { getGoogleOAuthClient } = require('../config/googleAuth');
const pool = require('../config/db');

/**
 * Builds an authenticated OAuth client for a specific stored account,
 * and keeps the database updated if Google issues a refreshed access token.
 */
async function getAuthClientForAccount(account) {
  const oauth2Client = getGoogleOAuthClient();

  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: account.token_expiry ? new Date(account.token_expiry).getTime() : null,
  });

  // If Google refreshes the token during this request, save the new one
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      const newExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
      await pool.query(
        `UPDATE accounts SET access_token = ?, token_expiry = ?
         WHERE id = ?`,
        [tokens.access_token, newExpiry, account.id]
      );
    }
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

module.exports = { fetchDriveFiles };