const crypto = require('crypto');

/**
 * The worker's own key pair for website logins. Made fresh every time the
 * worker starts and kept only in memory - never written anywhere.
 *
 * The browser seals { username, password } with the PUBLIC key (AES-256-GCM
 * for the data, the AES key wrapped with RSA-OAEP/SHA-256, all WebCrypto), so
 * the backend in between can't read them. Only this process can open them.
 */

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyId = `w${crypto.randomBytes(9).toString('hex')}`;
const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

/** Open a sealed login. Returns { username, password, loginUrl? } or throws. */
function open(sealed) {
  if (!sealed || sealed.keyId !== keyId) {
    const err = new Error('The login details were locked for a different run of the video editor.');
    err.code = 'LOGIN_KEY_MISMATCH';
    throw err;
  }
  const aesKey = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(sealed.wrappedKey, 'base64'));
  const data = Buffer.from(sealed.data, 'base64');
  const tag = data.subarray(data.length - 16); // WebCrypto puts the GCM tag at the end
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  aesKey.fill(0);
  const json = JSON.parse(plain.toString('utf8'));
  plain.fill(0);
  return { username: String(json.username || ''), password: String(json.password || '') };
}

/** For tests: seal the way the browser does (WebCrypto layout). */
function sealForTest(obj) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const wrappedKey = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aesKey);
  return { keyId, wrappedKey: wrappedKey.toString('base64'), iv: iv.toString('base64'), data: enc.toString('base64') };
}

module.exports = { keyId, publicKeyB64, open, sealForTest };
