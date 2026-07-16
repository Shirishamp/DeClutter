const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { fetchDriveFiles } = require('../services/googleDrive.service');

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