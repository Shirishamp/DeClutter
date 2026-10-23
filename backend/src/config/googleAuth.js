const { google } = require('googleapis');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function getGoogleOAuthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  const missing = [
    ['GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', GOOGLE_CLIENT_SECRET],
    ['GOOGLE_REDIRECT_URI', GOOGLE_REDIRECT_URI],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing required Google OAuth configuration: ${missing.join(', ')}`);
  }

  let redirectUri;
  try {
    redirectUri = new URL(GOOGLE_REDIRECT_URI);
  } catch {
    throw new Error('GOOGLE_REDIRECT_URI must be a valid URL');
  }

  if (
    !['http:', 'https:'].includes(redirectUri.protocol) ||
    redirectUri.pathname !== '/api/auth/google/callback' ||
    redirectUri.search ||
    redirectUri.hash
  ) {
    throw new Error('GOOGLE_REDIRECT_URI must exactly match /api/auth/google/callback');
  }

  const redirectPort = Number(redirectUri.port || (redirectUri.protocol === 'https:' ? 443 : 80));
  const serverPort = Number(process.env.PORT || 5000);
  if (
    ['localhost', '127.0.0.1', '[::1]'].includes(redirectUri.hostname) &&
    redirectPort !== serverPort
  ) {
    throw new Error('The local GOOGLE_REDIRECT_URI port must match PORT (default 5000)');
  }

  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

module.exports = { getGoogleOAuthClient };