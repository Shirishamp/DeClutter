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

    if (!tokens.access_token) {
      return res.status(502).json({
        status: 'error',
        message: 'Google did not return an access token. Please try connecting again.',
      });
    }

    oauth2Client.setCredentials(tokens);

    // Get the connected account's email
    const oauth2 = require('googleapis').google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const expiryDate = Number.isFinite(tokens.expiry_date) && tokens.expiry_date > 0
      ? new Date(tokens.expiry_date)
      : null;

    const [existingAccounts] = await pool.query(
      'SELECT id, refresh_token FROM accounts WHERE provider = ? AND email = ? ORDER BY id ASC LIMIT 1',
      ['google_drive', userInfo.email]
    );

    if (existingAccounts.length > 0) {
      const existingAccount = existingAccounts[0];
      if (!tokens.refresh_token && !existingAccount.refresh_token) {
        return res.status(502).json({
          status: 'error',
          message:
            'Google did not provide a refresh token. Reconnect the account and grant offline Drive access.',
        });
      }

      await pool.query(
        `UPDATE accounts
         SET access_token = ?, refresh_token = COALESCE(?, refresh_token),
             token_expiry = COALESCE(?, token_expiry)
         WHERE id = ?`,
        [tokens.access_token, tokens.refresh_token || null, expiryDate, existingAccount.id]
      );
      res.send(`Google Drive account reconnected successfully: ${userInfo.email}. You can close this tab.`);
    } else {
      if (!tokens.refresh_token) {
        return res.status(502).json({
          status: 'error',
          message:
            'Google did not provide a refresh token. Reconnect the account and grant offline Drive access.',
        });
      }

      await pool.query(
        `INSERT INTO accounts (provider, account_label, email, access_token, refresh_token, token_expiry)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          'google_drive',
          'Personal', // placeholder label for now — customizable in a later phase
          userInfo.email,
          tokens.access_token,
          tokens.refresh_token,
          expiryDate,
        ]
      );
      res.send(`Google Drive account connected successfully: ${userInfo.email}. You can close this tab.`);
    }
  } catch (err) {
    console.error('Google OAuth callback failed:', err.message);
    res.status(500).json({ status: 'error', message: 'Google account connection failed. Please try again.' });
  }
});

module.exports = router;