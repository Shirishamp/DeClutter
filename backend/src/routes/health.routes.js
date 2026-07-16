const express = require('express');
const router = express.Router();

// GET /api/health
router.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

module.exports = router;