const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { fetchDriveFiles, copyDriveFile } = require('../services/googleDrive.service');

function isPositiveInteger(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0;
}

async function saveCopiedFile(accountId, file) {
  await pool.query(
    `INSERT INTO files (account_id, file_id, file_name, file_type, file_size, folder_path, modified_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       file_name = VALUES(file_name),
       file_type = VALUES(file_type),
       file_size = VALUES(file_size),
       folder_path = VALUES(folder_path),
       modified_date = VALUES(modified_date)`,
    [
      accountId,
      file.id,
      file.name,
      file.mimeType,
      file.size ? parseInt(file.size, 10) : null,
      'My Drive',
      file.modifiedTime ? new Date(file.modifiedTime) : null,
    ]
  );
}

// POST /api/files/sync/:accountId
// Fetches fresh metadata from the provider and upserts it into the files table
router.post('/sync/:accountId', async (req, res) => {
  const { accountId } = req.params;

  try {
    const [accountRows] = await pool.query('SELECT * FROM accounts WHERE id = ?', [accountId]);
    if (accountRows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Account not found' });
    }

    const account = accountRows[0];

    if (account.provider !== 'google_drive') {
      return res.status(400).json({ status: 'error', message: 'Only google_drive accounts are supported right now' });
    }

    const files = await fetchDriveFiles(account);

    for (const file of files) {
      await pool.query(
        `INSERT INTO files (account_id, file_id, file_name, file_type, file_size, folder_path, modified_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           file_name = VALUES(file_name),
           file_type = VALUES(file_type),
           file_size = VALUES(file_size),
           folder_path = VALUES(folder_path),
           modified_date = VALUES(modified_date)`,
        [
          accountId,
          file.file_id,
          file.file_name,
          file.file_type,
          file.file_size,
          file.folder_path,
          file.modified_date,
        ]
      );
    }

    res.json({ status: 'ok', message: 'Sync complete', filesSynced: files.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// POST /api/files/move
// Copies one indexed file to another connected account and keeps the original.
router.post('/move', async (req, res) => {
  const { sourceAccountId, destinationAccountId, fileId } = req.body;

  if (
    !isPositiveInteger(sourceAccountId) ||
    !isPositiveInteger(destinationAccountId) ||
    !fileId ||
    typeof fileId !== 'string'
  ) {
    return res.status(400).json({
      status: 'error',
      message: 'sourceAccountId, destinationAccountId, and fileId are required',
    });
  }

  if (Number(sourceAccountId) === Number(destinationAccountId)) {
    return res.status(400).json({ status: 'error', message: 'Choose a different destination account' });
  }

  try {
    const [accounts] = await pool.query(
      `SELECT id, provider, email, access_token, refresh_token, token_expiry
       FROM accounts
       WHERE id IN (?, ?)`,
      [sourceAccountId, destinationAccountId]
    );
    const sourceAccount = accounts.find((account) => Number(account.id) === Number(sourceAccountId));
    const destinationAccount = accounts.find(
      (account) => Number(account.id) === Number(destinationAccountId)
    );

    if (!sourceAccount || !destinationAccount) {
      return res.status(404).json({ status: 'error', message: 'Source or destination account not found' });
    }

    if (sourceAccount.provider !== 'google_drive' || destinationAccount.provider !== 'google_drive') {
      return res.status(400).json({ status: 'error', message: 'Both accounts must be Google Drive accounts' });
    }

    const [files] = await pool.query(
      `SELECT file_id, file_name, file_type
       FROM files
       WHERE account_id = ? AND file_id = ?`,
      [sourceAccountId, fileId]
    );
    if (files.length === 0) {
      return res.status(404).json({ status: 'error', message: 'File not found in the source account' });
    }

    const copyResult = await copyDriveFile(sourceAccount, destinationAccount, fileId);

    try {
      await saveCopiedFile(destinationAccountId, copyResult.copiedFile);
    } catch (error) {
      console.error('File copied to Drive, but failed to save its destination index entry', error);
      return res.status(500).json({
        status: 'partial',
        message: 'The file was copied to the destination Drive, but its index could not be updated.',
        fileName: copyResult.sourceFile.name,
        destinationFileId: copyResult.copiedFile.id,
      });
    }

    res.json({
      status: 'ok',
      message: 'File copied to the destination Drive. The original was kept.',
      fileName: copyResult.sourceFile.name,
      destinationAccountId: Number(destinationAccountId),
      warning: copyResult.permissionCleanupError
        ? 'The copy succeeded, but a temporary sharing permission could not be removed.'
        : undefined,
    });
  } catch (err) {
    console.error(err);
    const providerStatus = Number(err.statusCode || (err.response && err.response.status) || err.code);
    const statusCode =
      Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus <= 599
        ? providerStatus
        : 500;
    const reauthorizationHint =
      statusCode === 401 || statusCode === 403
        ? ' Reconnect both Google Drive accounts and approve Drive access. The source account must also allow sharing and copying this file.'
        : '';
    res.status(statusCode).json({ status: 'error', message: `${err.message}${reauthorizationHint}` });
  }
});

// GET /api/files/:accountId
// Lists stored metadata for a given account (for verification / testing)
router.get('/:accountId', async (req, res) => {
  const { accountId } = req.params;

  try {
    const [rows] = await pool.query(
      'SELECT file_name, file_type, file_size, folder_path, modified_date FROM files WHERE account_id = ?',
      [accountId]
    );
    res.json({ status: 'ok', count: rows.length, files: rows });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;