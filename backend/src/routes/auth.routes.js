const express = require('express');
const router = express.Router();
const { getGoogleOAuthClient } = require('../config/googleAuth');
const pool = require('../config/db');

// GET /api/auth/google
// Redirects the user to Google's consent screen
router.get('/google', (req, res) => {
  const oauth2Client = getGoogleOAuthClient();

  const scopes = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh_token
    prompt: 'consent',      // forces Google to always return a refresh_token
    scope: scopes,
  });

  res.redirect(url);
});

// GET /api/auth/google/callback
// Google redirects here after the user grants permission
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).json({ status: 'error', message: 'Missing authorization code' });
  }

  try {
    const oauth2Client = getGoogleOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get the connected account's email
    const oauth2 = require('googleapis').google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const expiryDate = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : null;

    const [existingAccounts] = await pool.query(
      'SELECT id FROM accounts WHERE provider = ? AND email = ? ORDER BY id ASC LIMIT 1',
      ['google_drive', userInfo.email]
    );

    if (existingAccounts.length > 0) {
      await pool.query(
        `UPDATE accounts
         SET access_token = ?, refresh_token = COALESCE(?, refresh_token), token_expiry = ?
         WHERE id = ?`,
        [tokens.access_token, tokens.refresh_token || null, expiryDate, existingAccounts[0].id]
      );
      res.send(`Google Drive account reconnected successfully: ${userInfo.email}. You can close this tab.`);
    } else {
      await pool.query(
        `INSERT INTO accounts (provider, account_label, email, access_token, refresh_token, token_expiry)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          'google_drive',
          'Personal', // placeholder label for now — customizable in a later phase
          userInfo.email,
          tokens.access_token,
          tokens.refresh_token || null,
          expiryDate,
        ]
      );
      res.send(`Google Drive account connected successfully: ${userInfo.email}. You can close this tab.`);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;