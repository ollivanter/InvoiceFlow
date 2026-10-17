'use strict';

const crypto = require('crypto');
const config = require('./config');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(value) {
  return crypto.createHmac('sha256', config.APP_SECRET).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ─── Passwords (PBKDF2-SHA512, 210k iterations, per-user salt) ─────────────
const ITERATIONS = 210000;

function pbkdf2(password, salt, iterations, digest) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 64, digest, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await pbkdf2(password, salt, ITERATIONS, 'sha512');
  return `pbkdf2$sha512$${ITERATIONS}$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [kind, digest, iterations, salt, key] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !digest || !iterations || !salt || !key) return false;
  const candidate = await pbkdf2(password, salt, Number(iterations), digest);
  const expected = Buffer.from(key, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

// ─── Encryption at rest for user business data (AES-256-GCM) ───────────────
let cachedKey;
function dataKey() {
  if (!cachedKey) cachedKey = crypto.createHash('sha256').update(config.DATA_ENCRYPTION_KEY).digest();
  return cachedKey;
}

function encryptJson(value, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

// The AAD binds each ciphertext to its owner, so a row copied to another user cannot be decrypted.
function decryptJson(payload, aad) {
  const [version, iv, tag, ciphertext] = String(payload).split('.');
  if (version !== 'v1') throw new Error('Unknown encryption version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const plain = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function randomCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

module.exports = { sha256, hmac, safeEqual, hashPassword, verifyPassword, encryptJson, decryptJson, randomCode, randomToken };
