const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET /api/accounts
// Lists all connected accounts with a count of synced files
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.provider, a.account_label, a.email,
              COUNT(f.id) AS file_count
       FROM accounts a
       LEFT JOIN files f ON f.account_id = a.id
       GROUP BY a.id, a.provider, a.account_label, a.email
       ORDER BY a.id ASC`
    );
    res.json({ status: 'ok', accounts: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// PATCH /api/accounts/:id
// Renames an account's label
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { accountLabel } = req.body;

  if (!accountLabel || !accountLabel.trim()) {
    return res.status(400).json({ status: 'error', message: 'accountLabel is required' });
  }

  try {
    const [result] = await pool.query(
      'UPDATE accounts SET account_label = ? WHERE id = ?',
      [accountLabel.trim(), id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Account not found' });
    }

    res.json({ status: 'ok', message: 'Label updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// DELETE /api/accounts/:id
// Removes an account and its synced files (via ON DELETE CASCADE)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query('DELETE FROM accounts WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Account not found' });
    }

    res.json({ status: 'ok', message: 'Account deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;