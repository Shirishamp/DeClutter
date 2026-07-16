const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET /api/db-check
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS result');
    res.json({ status: 'ok', message: 'Database connected', result: rows[0].result });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;