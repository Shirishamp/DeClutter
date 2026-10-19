const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET /api/search?q=searchTerm
router.get('/', async (req, res) => {
  const query = (req.query.q || '').trim();

  if (!query) {
    return res.status(400).json({ status: 'error', message: 'Search query "q" is required' });
  }

  try {
    // Fetch all matching files, along with which account each belongs to
    const [rows] = await pool.query(
      `SELECT f.file_id, f.account_id, f.file_name, f.file_type, f.file_size, f.modified_date,
              a.provider, a.account_label, a.email
       FROM files f
       JOIN accounts a ON f.account_id = a.id
       WHERE f.file_name LIKE ?
       ORDER BY f.file_name ASC`,
      [`%${query}%`]
    );

    // Group rows by file_name, collecting which accounts each file is available in
    const grouped = new Map();

    for (const row of rows) {
      if (!grouped.has(row.file_name)) {
        grouped.set(row.file_name, {
          fileName: row.file_name,
          isExactMatch: row.file_name.toLowerCase() === query.toLowerCase(),
          availableIn: [],
        });
      }
      grouped.get(row.file_name).availableIn.push({
        fileId: row.file_id,
        accountId: row.account_id,
        fileType: row.file_type,
        provider: row.provider,
        accountLabel: row.account_label,
        email: row.email,
      });
    }

    // Convert to array and rank exact matches above partial matches
    const results = Array.from(grouped.values()).sort((a, b) => {
      if (a.isExactMatch && !b.isExactMatch) return -1;
      if (!a.isExactMatch && b.isExactMatch) return 1;
      return a.fileName.localeCompare(b.fileName);
    });

    res.json({ status: 'ok', count: results.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;