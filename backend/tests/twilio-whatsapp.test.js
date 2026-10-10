const assert = require('assert');

// This test deliberately calls the real whatsappTwilio.sendMessage so it
// can verify the exact HTTP request shape (URL, basic auth header, form-
// encoded body). It stubs global.fetch so no real Twilio call ever goes
// out. The sendGuard, however, runs BEFORE fetch - so we opt in here
// with a stubbed fetch that intercepts the request. ALLOW_REAL_SENDS=1
// is scoped to this one test file only: process.env assignments in a
// child Node process never leak back to the parent runner or to other
// test files.
process.env.ALLOW_REAL_SENDS = '1';

async function main() {
  process.env.TWILIO_ACCOUNT_SID = 'ACtest123';
  process.env.TWILIO_AUTH_TOKEN = 'secrettoken';
  delete process.env.TWILIO_WHATSAPP_FROM;

  let capturedRequest = null;
  global.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return { ok: true, json: async () => ({ sid: 'SM123', status: 'queued' }) };
  };

  const twilio = require('../core/whatsappTwilio');
  await twilio.sendMessage('+233000000000', 'Hello from the test');

  assert.strictEqual(capturedRequest.url, 'https://api.twilio.com/2010-04-01/Accounts/ACtest123/Messages.json');
  assert.strictEqual(capturedRequest.options.method, 'POST');

  const expectedAuth = 'Basic ' + Buffer.from('ACtest123:secrettoken').toString('base64');
  assert.strictEqual(capturedRequest.options.headers.Authorization, expectedAuth);

  const decoded = decodeURIComponent(capturedRequest.options.body.toString().replace(/\+/g, ' '));
  assert(decoded.includes('Body=Hello from the test'), 'body should include the message text');
  assert(decoded.includes('From=whatsapp:+14155238886'), 'From should default to the sandbox number with whatsapp: prefix');
  assert(decoded.includes('To=whatsapp:+233000000000'), 'To should be normalized with whatsapp: prefix');
  assert(!decoded.trim().startsWith('{'), 'body must be form-encoded, not JSON - this is what Twilio actually requires');
  console.log('✓ Twilio client produces the exact real API request shape (URL, auth, form-encoded body)');

  console.log('\nAll Twilio WhatsApp checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
