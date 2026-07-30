const { google } = require('googleapis');
const config = require('../config');
const tokenStore = require('./tokenStore');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

function assertConfigured() {
  if (!config.google.clientId || !config.google.clientSecret) {
    throw new Error(
      'Google OAuth not configured - set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env'
    );
  }
}

function newOAuth2Client() {
  assertConfigured();
  return new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
}

/** Builds the URL the user visits to grant Gmail access. */
function getAuthUrl() {
  const client = newOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh_token
    prompt: 'consent', // forces refresh_token on every connect, not just the first
    scope: SCOPES,
  });
}

/** Exchanges the authorization code from Google's redirect for tokens, and persists them. */
async function handleCallback(code) {
  const client = newOAuth2Client();
  const { tokens } = await client.getToken(code);
  await tokenStore.save('google', tokens);
  return tokens;
}

/**
 * Returns an authenticated OAuth2 client ready to use with any Gmail API call.
 * Automatically persists refreshed access tokens back to the store.
 * Throws a clear error if Gmail was never connected.
 */
async function getAuthorizedClient() {
  const saved = await tokenStore.get('google');
  if (!saved) {
    throw new Error('Gmail not connected - visit /auth/google to connect your account');
  }

  const client = newOAuth2Client();
  client.setCredentials(saved);

  client.on('tokens', (newTokens) => {
    // google's client fires this when it silently refreshes the access token
    tokenStore.save('google', { ...saved, ...newTokens }).catch((err) => {
      console.warn(`[googleAuth] failed to persist refreshed token: ${err.message}`);
    });
  });

  return client;
}

async function isConnected() {
  const saved = await tokenStore.get('google');
  return !!saved;
}

module.exports = { getAuthUrl, handleCallback, getAuthorizedClient, isConnected };
