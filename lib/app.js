'use strict';

const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const sec = require('./security');
const validate = require('./validate');
const { SECURITY_HEADERS } = require('./headers');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// ─── Entry point (shared by api/index.js on Vercel and server.js locally) ───
async function handle(req, res) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (config.IS_PROD || key !== 'Strict-Transport-Security') res.setHeader(key, value);
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    // Vercel already redirects HTTP → HTTPS; this covers other proxies in production.
    if (config.IS_PROD && req.headers['x-forwarded-proto'] === 'http') {
      throw new HttpError(400, 'HTTPS is required.');
    }
    const url = new URL(req.url, 'http://localhost');
    let pathname = url.pathname.replace(/\/+$/, '');
    if (pathname === '/api/index' || pathname === '/api') pathname = `/api/${url.searchParams.get('route') || ''}`.replace(/\/+$/, '');
    if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);

    const handler = routes[`${req.method} ${pathname}`];
    if (!handler) throw new HttpError(404, 'Not found');
    await db.ensureSchema();
    const result = await handler(req, res, url);
    if (result !== undefined && !res.writableEnded) sendJson(res, 200, result);
    db.maybeCleanup();
  } catch (error) {
    if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, ...(error.extra || {}) });
    if (error instanceof validate.ValidationError) return sendJson(res, 400, { error: error.message });
    console.error('[api]', error);
    sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host = '';
  try { host = new URL(origin).host; } catch { /* invalid origin */ }
  const expected = req.headers['x-forwarded-host'] || req.headers.host;
  if (host !== expected) throw new HttpError(403, 'Cross-origin request blocked.');
}

// ─── Routes ─────────────────────────────────────────────────────────────────
const routes = {
  'GET /api/health': async () => {
    await db.query('SELECT 1');
    return { ok: true };
  },
  'GET /api/config': () => ({
    turnstileSiteKey: config.TURNSTILE_SITE_KEY || null,
    termsVersion: config.TERMS_VERSION,
    minimumAge: config.MIN_AGE
  }),

  'POST /api/auth/otp': requestOtp,
  'POST /api/auth/register': register,
  'POST /api/auth/login': login,
  'POST /api/auth/reset': resetPassword,
  'POST /api/auth/logout': logout,
  'GET /api/auth/me': async req => {
    const auth = await getAuth(req);
    return { user: auth ? publicUser(auth.user) : null };
  },

  'GET /api/sync': withAuth(async (req, res, auth) => loadData(auth.user.id)),
  'PUT /api/sync': withAuth(putSync),

  'GET /api/backups': withAuth(async (req, res, auth) => ({ backups: await listBackups(auth.user.id) })),
  'POST /api/backups': withAuth(async (req, res, auth) => {
    await rateLimit(`backup:${auth.user.id}`, 20, 60 * 60 * 1000);
    await db.withUser(auth.user.id, c => createBackup(c, auth.user.id, 'manual'));
    return { backups: await listBackups(auth.user.id) };
  }),
  'POST /api/backups/restore': withAuth(restoreBackup),

  'PATCH /api/account': withAuth(updateAccount),
  'POST /api/account/password': withAuth(changePassword),
  'POST /api/account/logout-others': withAuth(async (req, res, auth) => {
    const { rowCount } = await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [auth.user.id, auth.sessionId]);
    return { ok: true, revoked: rowCount };
  }),
  'POST /api/account/consent': withAuth(async (req, res, auth) => {
    const body = await readJson(req);
    if (body.acceptTerms !== true) throw new HttpError(400, 'Please accept the Terms of Service and Privacy Policy to continue.');
    if (body.ageConfirmed !== true) throw new HttpError(400, `You must be at least ${config.MIN_AGE} years old to use this service.`);
    const { rows } = await db.query(
      `UPDATE users SET terms_version = $1, terms_accepted_at = now(), age_confirmed_at = COALESCE(age_confirmed_at, now()), updated_at = now()
       WHERE id = $2 RETURNING *`,
      [config.TERMS_VERSION, auth.user.id]
    );
    return { user: publicUser(rows[0]) };
  }),
  'GET /api/account/export': withAuth(exportAccount),
  'POST /api/account/delete': withAuth(deleteAccount),

  'GET /api/email/unsubscribe': unsubscribe,
  'POST /api/email/unsubscribe': unsubscribe
};

function withAuth(handler) {
  return async (req, res, url) => {
    const auth = await getAuth(req);
    if (!auth) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    return handler(req, res, auth, url);
  };
}

// ─── Auth ───────────────────────────────────────────────────────────────────
function otpKey(purpose, email) {
  return `${purpose}:${email}`;
}

function otpHash(key, code) {
  return sec.hmac(`otp:${key}:${code}`);
}

async function requestOtp(req) {
  const body = await readJson(req);
  await assertHuman(req, body);
  const purpose = body.purpose === 'reset' ? 'reset' : 'register';
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');

  await rateLimit(`otp-ip:${clientIp(req)}`, 20, 15 * 60 * 1000);
  await rateLimit(`otp-email:${email}`, 6, 15 * 60 * 1000);

  const user = await findUserByEmail(email);
  if (purpose === 'register') {
    validateRegistration(body);
    if (user) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
  } else if (!user) {
    // Same response whether or not the account exists, so emails can't be enumerated.
    return { ok: true };
  }

  const key = otpKey(purpose, email);
  const { rows } = await db.query('SELECT sent_at FROM otps WHERE key = $1', [key]);
  if (rows[0]) {
    const elapsed = Date.now() - new Date(rows[0].sent_at).getTime();
    if (elapsed < config.OTP_RESEND_MS) {
      throw new HttpError(429, `Please wait ${Math.ceil((config.OTP_RESEND_MS - elapsed) / 1000)}s before requesting another code.`);
    }
  }

  const code = sec.randomCode();
  await db.query(
    `INSERT INTO otps (key, code_hash, expires_at, attempts, sent_at)
     VALUES ($1, $2, now() + make_interval(secs => $3), 0, now())
     ON CONFLICT (key) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, sent_at = now()`,
    [key, otpHash(key, code), config.OTP_TTL_MS / 1000]
  );

  const product = config.business.productName;
  await sendMail(req, {
    to: email,
    subject: purpose === 'register' ? `Verify your ${product} email` : `Reset your ${product} password`,
    heading: purpose === 'register' ? 'Confirm your email address' : 'Reset your password',
    body: `Your verification code is <strong style="font-size:22px;letter-spacing:4px">${code}</strong>. It expires in 10 minutes.`,
    textBody: `Your verification code is ${code}. It expires in 10 minutes.`,
    reason: purpose === 'register'
      ? 'You are receiving this because someone used this address to create an account. If it was not you, ignore this email and no account will be created.'
      : 'You are receiving this because a password reset was requested for your account. If it was not you, you can ignore this email.'
  });

  return { ok: true, ...(config.EXPOSE_DEV_CODES ? { devCode: code } : {}) };
}

async function consumeOtp(purpose, email, code) {
  const key = otpKey(purpose, email);
  const { rows } = await db.query(
    'UPDATE otps SET attempts = attempts + 1 WHERE key = $1 RETURNING code_hash, expires_at, attempts',
    [key]
  );
  const entry = rows[0];
  if (!entry) throw new HttpError(400, 'No verification code was requested for this email. Request a new one.');
  if (new Date(entry.expires_at).getTime() < Date.now()) {
    await db.query('DELETE FROM otps WHERE key = $1', [key]);
    throw new HttpError(400, 'This code has expired. Request a new one.');
  }
  const given = String(code || '').replace(/\D/g, '').slice(0, 6);
  if (!sec.safeEqual(otpHash(key, given), entry.code_hash)) {
    if (entry.attempts >= config.OTP_MAX_ATTEMPTS) {
      await db.query('DELETE FROM otps WHERE key = $1', [key]);
      throw new HttpError(400, 'Too many incorrect attempts. Request a new code.');
    }
    throw new HttpError(400, `Incorrect code. ${config.OTP_MAX_ATTEMPTS - entry.attempts} attempt(s) left.`);
  }
  // Single use: only one concurrent request can delete the row.
  const consumed = await db.query('DELETE FROM otps WHERE key = $1 AND code_hash = $2', [key, entry.code_hash]);
  if (!consumed.rowCount) throw new HttpError(400, 'This code has already been used. Request a new one.');
}

function validateRegistration(body) {
  const name = String(body.name || '').trim();
  if (!name) throw new HttpError(400, 'Please enter your name.');
  if (name.length > 120) throw new HttpError(400, 'Name is too long.');
  validatePassword(String(body.password || ''));
  if (body.acceptTerms !== true) throw new HttpError(400, 'Please accept the Terms of Service and Privacy Policy to continue.');
  if (body.ageConfirmed !== true) throw new HttpError(400, `You must be at least ${config.MIN_AGE} years old to create an account.`);
}

async function register(req, res) {
  const body = await readJson(req);
  await assertHuman(req, body);
  const email = normalizeEmail(body.email);
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  validateRegistration(body);
  await rateLimit(`register-ip:${clientIp(req)}`, 20, 15 * 60 * 1000);
  if (await findUserByEmail(email)) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
  await consumeOtp('register', email, body.code);

  const id = crypto.randomUUID();
  const name = String(body.name).trim();
  const passwordHash = await sec.hashPassword(String(body.password));
  try {
    await db.query(
      `INSERT INTO users (id, name, email, password_hash, terms_version, terms_accepted_at, age_confirmed_at, marketing_opt_in)
       VALUES ($1, $2, $3, $4, $5, now(), now(), $6)`,
      [id, name, email, passwordHash, config.TERMS_VERSION, body.marketingOptIn === true]
    );
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    throw error;
  }
  const doc = validate.userDoc({ profile: { name, email } });
  await db.withUser(id, c => c.query(
    'INSERT INTO user_data (user_id, doc_enc, revision, updated_at) VALUES ($1, $2, 0, now())',
    [id, sec.encryptJson(doc, `user_data:${id}`)]
  ));
  await startSession(req, res, id);
  const user = await findUserById(id);
  return { user: publicUser(user), data: await loadData(id) };
}

let dummyHash;
async function login(req, res) {
  const body = await readJson(req);
  await assertHuman(req, body);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  await rateLimit(`login-ip:${clientIp(req)}`, 30, 15 * 60 * 1000);
  await rateLimit(`login-email:${email}`, 10, 15 * 60 * 1000);
  const user = await findUserByEmail(email);
  // Always run a hash comparison so response time doesn't reveal whether the email exists.
  dummyHash = dummyHash || await sec.hashPassword(sec.randomToken());
  const valid = await sec.verifyPassword(password, user ? user.password_hash : dummyHash);
  if (!user || !valid) throw new HttpError(401, 'Incorrect email or password.');
  await startSession(req, res, user.id);
  return { user: publicUser(user), data: await loadData(user.id) };
}

async function resetPassword(req, res) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  validatePassword(password);
  await rateLimit(`reset-ip:${clientIp(req)}`, 20, 15 * 60 * 1000);
  const user = await findUserByEmail(email);
  if (!user) throw new HttpError(400, 'Incorrect or expired code.');
  await consumeOtp('reset', email, body.code);
  await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await sec.hashPassword(password), user.id]);
  // A reset signs out every existing session.
  await db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
  await startSession(req, res, user.id);
  return { user: publicUser(user), data: await loadData(user.id) };
}

async function logout(req, res) {
  const token = getCookies(req)[config.SESSION_COOKIE];
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sec.sha256(token)]);
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  return { ok: true };
}

async function startSession(req, res, userId) {
  const token = sec.randomToken();
  await db.query(
    'INSERT INTO sessions (id, token_hash, user_id, expires_at) VALUES ($1, $2, $3, now() + make_interval(secs => $4))',
    [crypto.randomUUID(), sec.sha256(token), userId, config.SESSION_TTL_MS / 1000]
  );
  res.setHeader('Set-Cookie', sessionCookie(token, config.SESSION_TTL_MS / 1000));
}

async function getAuth(req) {
  const token = getCookies(req)[config.SESSION_COOKIE];
  if (!token || token.length > 100) return null;
  const { rows } = await db.query(
    `SELECT s.id AS session_id, u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sec.sha256(token)]
  );
  if (!rows[0]) return null;
  const { session_id: sessionId, ...user } = rows[0];
  return { user, sessionId };
}

function sessionCookie(value, maxAge) {
  return `${config.SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(maxAge)}${config.IS_PROD ? '; Secure' : ''}`;
}

// Honeypot + optional Cloudflare Turnstile.
async function assertHuman(req, body) {
  if (body.website) throw new HttpError(400, 'Request rejected.');
  if (!config.TURNSTILE_SECRET_KEY) return;
  const token = String(body.turnstileToken || '');
  if (!token) throw new HttpError(400, 'Please complete the verification challenge.');
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: config.TURNSTILE_SECRET_KEY, response: token, remoteip: clientIp(req) })
  });
  const result = await response.json().catch(() => ({}));
  if (!result.success) throw new HttpError(400, 'Verification challenge failed. Please try again.');
}

// ─── Account ────────────────────────────────────────────────────────────────
async function updateAccount(req, res, auth) {
  const body = await readJson(req);
  const user = auth.user;
  let name = user.name;
  let marketing = user.marketing_opt_in;
  if (body.name !== undefined) {
    name = String(body.name || '').trim();
    if (!name || name.length > 120) throw new HttpError(400, 'Please enter a valid name.');
  }
  if (body.marketingOptIn !== undefined) marketing = body.marketingOptIn === true;
  const { rows } = await db.query(
    'UPDATE users SET name = $1, marketing_opt_in = $2, updated_at = now() WHERE id = $3 RETURNING *',
    [name, marketing, user.id]
  );
  return { user: publicUser(rows[0]) };
}

async function changePassword(req, res, auth) {
  const body = await readJson(req);
  await rateLimit(`password:${auth.user.id}`, 10, 15 * 60 * 1000);
  if (!(await sec.verifyPassword(String(body.currentPassword || ''), auth.user.password_hash))) {
    throw new HttpError(400, 'Your current password is incorrect.');
  }
  const next = String(body.newPassword || '');
  validatePassword(next);
  await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await sec.hashPassword(next), auth.user.id]);
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [auth.user.id, auth.sessionId]);
  return { ok: true };
}

async function exportAccount(req, res, auth) {
  await rateLimit(`export:${auth.user.id}`, 10, 60 * 60 * 1000);
  const user = auth.user;
  const payload = {
    exportedAt: new Date().toISOString(),
    account: {
      ...publicUser(user),
      termsVersion: user.terms_version,
      termsAcceptedAt: user.terms_accepted_at,
      ageConfirmedAt: user.age_confirmed_at
    },
    data: await loadData(user.id),
    backups: await listBackups(user.id)
  };
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="invoiceflow-export-${new Date().toISOString().slice(0, 10)}.json"`,
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function deleteAccount(req, res, auth) {
  const body = await readJson(req);
  await rateLimit(`delete:${auth.user.id}`, 5, 15 * 60 * 1000);
  if (!(await sec.verifyPassword(String(body.password || ''), auth.user.password_hash))) {
    throw new HttpError(400, 'Incorrect password.');
  }
  const id = auth.user.id;
  await db.withUser(id, async c => {
    await c.query('DELETE FROM backups WHERE user_id = $1', [id]);
    await c.query('DELETE FROM user_data WHERE user_id = $1', [id]);
  });
  await db.query('DELETE FROM users WHERE id = $1', [id]); // cascades to sessions
  await db.query('DELETE FROM otps WHERE key = ANY($1)', [[otpKey('register', auth.user.email), otpKey('reset', auth.user.email)]]);
  res.setHeader('Set-Cookie', sessionCookie('', 0));
  return { ok: true };
}

async function unsubscribe(req, res, url) {
  const email = normalizeEmail(url.searchParams.get('e'));
  const token = String(url.searchParams.get('t') || '');
  const ok = isEmail(email) && sec.safeEqual(token, unsubscribeToken(email));
  if (ok) await db.query('UPDATE users SET marketing_opt_in = false, updated_at = now() WHERE email = $1', [email]);
  if (req.method === 'POST') return { ok }; // RFC 8058 one-click unsubscribe
  const product = config.business.productName;
  const message = ok
    ? 'You have been unsubscribed from product and marketing emails. You will still receive security emails (like verification codes) only when you request them.'
    : 'This unsubscribe link is invalid or has expired. You can manage email preferences in Settings → Account.';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences — ${escapeHtml(product)}</title><link rel="stylesheet" href="/css/legal.css"></head><body><main class="legal narrow"><h1>Email preferences</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to ${escapeHtml(product)}</a></p></main></body></html>`;
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function unsubscribeToken(email) {
  return sec.hmac(`unsubscribe:${email}`);
}

// ─── Data & sync ────────────────────────────────────────────────────────────
async function loadData(userId, client) {
  const run = async c => {
    const { rows } = await c.query('SELECT doc_enc, revision, updated_at FROM user_data WHERE user_id = $1', [userId]);
    if (!rows[0]) return { ...validate.emptyDoc(), revision: 0, updatedAt: null };
    return { ...sec.decryptJson(rows[0].doc_enc, `user_data:${userId}`), revision: rows[0].revision, updatedAt: rows[0].updated_at };
  };
  return client ? run(client) : db.withUser(userId, run);
}

async function putSync(req, res, auth) {
  const body = await readJson(req, config.SYNC_LIMIT);
  await rateLimit(`sync:${auth.user.id}`, 600, 15 * 60 * 1000);
  const baseRevision = Number.isInteger(body.baseRevision) ? body.baseRevision : -1;
  const doc = validate.userDoc(body);
  const userId = auth.user.id;
  const enc = sec.encryptJson(doc, `user_data:${userId}`);

  return db.withUser(userId, async c => {
    // Optimistic concurrency: only write if the client saw the latest revision. Otherwise return
    // the server copy so the client can merge and retry — devices never silently overwrite each other.
    let { rows } = await c.query(
      `UPDATE user_data SET doc_enc = $1, revision = revision + 1, updated_at = now()
       WHERE user_id = $2 AND revision = $3 RETURNING revision, updated_at, last_backup_at`,
      [enc, userId, baseRevision]
    );
    if (!rows[0] && baseRevision === 0) {
      ({ rows } = await c.query(
        `INSERT INTO user_data (user_id, doc_enc, revision, updated_at) VALUES ($1, $2, 1, now())
         ON CONFLICT (user_id) DO NOTHING RETURNING revision, updated_at, last_backup_at`,
        [userId, enc]
      ));
    }
    if (!rows[0]) throw new HttpError(409, 'Your data changed on another device.', { data: await loadData(userId, c) });
    const row = rows[0];
    if (!row.last_backup_at || Date.now() - new Date(row.last_backup_at).getTime() > config.AUTO_BACKUP_INTERVAL_MS) {
      await createBackup(c, userId, 'auto', doc);
    }
    return { revision: row.revision, updatedAt: row.updated_at };
  });
}

// ─── Backups ────────────────────────────────────────────────────────────────
async function createBackup(c, userId, reason, doc) {
  if (!doc) {
    const current = await loadData(userId, c);
    doc = { profile: current.profile, invoices: current.invoices, clients: current.clients, tombstones: current.tombstones };
  }
  const enc = sec.encryptJson(doc, `backup:${userId}`);
  await c.query(
    `INSERT INTO backups (user_id, reason, doc_enc, invoice_count, client_count, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, reason, enc, doc.invoices.length, doc.clients.length, Buffer.byteLength(enc)]
  );
  await c.query('UPDATE user_data SET last_backup_at = now() WHERE user_id = $1', [userId]);
  await c.query(
    `DELETE FROM backups WHERE user_id = $1 AND id NOT IN
     (SELECT id FROM backups WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`,
    [userId, config.MAX_BACKUPS_PER_USER]
  );
}

async function listBackups(userId) {
  return db.withUser(userId, async c => {
    const { rows } = await c.query(
      `SELECT id, created_at, reason, invoice_count, client_count, size_bytes FROM backups
       WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
      [userId]
    );
    return rows.map(r => ({
      id: String(r.id),
      createdAt: r.created_at,
      reason: r.reason,
      invoiceCount: r.invoice_count,
      clientCount: r.client_count,
      size: r.size_bytes
    }));
  });
}

async function restoreBackup(req, res, auth) {
  const body = await readJson(req);
  const id = String(body.id || '');
  if (!/^\d{1,18}$/.test(id)) throw new HttpError(400, 'Invalid backup id.');
  const userId = auth.user.id;
  const data = await db.withUser(userId, async c => {
    // RLS guarantees this only ever finds the caller's own backup.
    const { rows } = await c.query('SELECT doc_enc FROM backups WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!rows[0]) throw new HttpError(404, 'Backup not found.');
    const doc = validate.userDoc(sec.decryptJson(rows[0].doc_enc, `backup:${userId}`));
    await createBackup(c, userId, 'before-restore');
    await c.query(
      'UPDATE user_data SET doc_enc = $1, revision = revision + 1, updated_at = now() WHERE user_id = $2',
      [sec.encryptJson(doc, `user_data:${userId}`), userId]
    );
    return loadData(userId, c);
  });
  return { data };
}

// ─── Mail ───────────────────────────────────────────────────────────────────
async function sendMail(req, { to, subject, heading, body, textBody, reason }) {
  const b = config.business;
  const base = config.APP_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const unsubscribeUrl = `${base}/api/email/unsubscribe?e=${encodeURIComponent(to)}&t=${unsubscribeToken(to)}`;
  const footer = `${b.legalName} · ${b.address}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6fa;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td style="font-size:18px;font-weight:bold;color:#4f46e5;padding-bottom:20px">${escapeHtml(b.productName)}</td></tr>
<tr><td style="font-size:20px;font-weight:bold;padding-bottom:12px">${escapeHtml(heading)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;padding-bottom:20px">${body}</td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#475569;padding-bottom:20px">${escapeHtml(reason)}</td></tr>
<tr><td style="font-size:12px;line-height:1.6;color:#64748b;border-top:1px solid #e5e7ef;padding-top:16px">
${escapeHtml(footer)}<br>
<a href="${base}/legal/privacy.html" style="color:#4f46e5">Privacy Policy</a> ·
<a href="${unsubscribeUrl}" style="color:#4f46e5">Unsubscribe from marketing emails</a>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${heading}\n\n${textBody}\n\n${reason}\n\n—\n${footer}\nPrivacy Policy: ${base}/legal/privacy.html\nUnsubscribe from marketing emails: ${unsubscribeUrl}\n`;

  if (!config.RESEND_API_KEY) {
    // Without a provider the code is only logged in development; never log codes in production.
    if (!config.IS_PROD) console.log(`[mail] to=${to} subject="${subject}"\n${text}`);
    else console.warn('[mail] RESEND_API_KEY is not configured; email not sent.');
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.MAIL_FROM,
      to,
      subject,
      html,
      text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${b.privacyEmail}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    })
  });
  if (!response.ok) {
    console.error('[mail] send failed with status', response.status);
    throw new HttpError(502, 'We could not send the email right now. Please try again.');
  }
}

// ─── Rate limiting (stored in Postgres so it works across serverless instances) ─
async function rateLimit(key, limit, windowMs) {
  const { rows } = await db.query(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
       reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
     RETURNING count, reset_at`,
    [key, windowMs / 1000]
  );
  const { count, reset_at: resetAt } = rows[0];
  if (count > limit) {
    const minutes = Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 60000));
    throw new HttpError(429, `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }
}

function clientIp(req) {
  const forwarded = req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

// ─── Helpers ────────────────────────────────────────────────────────────────
async function readJson(req, limit = config.JSON_LIMIT) {
  // On Vercel the body may already be read and parsed by the runtime.
  let preParsed;
  try { preParsed = req.body; } catch { throw new HttpError(400, 'Malformed request body.'); }
  if (preParsed !== undefined && preParsed !== null) {
    const raw = Buffer.isBuffer(preParsed) ? preParsed.toString('utf8') : preParsed;
    if (typeof raw === 'string') {
      if (Buffer.byteLength(raw) > limit) throw new HttpError(413, 'Request is too large.');
      return parseJson(raw);
    }
    if (Buffer.byteLength(JSON.stringify(raw)) > limit) throw new HttpError(413, 'Request is too large.');
    return isPlainObject(raw) ? raw : {};
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  return chunks.length ? parseJson(Buffer.concat(chunks).toString('utf8')) : {};
}

function parseJson(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    throw new HttpError(400, 'Malformed request body.');
  }
}

function sendJson(res, status, payload) {
  if (res.headersSent) return res.end();
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function getCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((cookies, part) => {
    const [key, ...value] = part.trim().split('=');
    if (key) {
      try { cookies[key] = decodeURIComponent(value.join('=')); } catch { /* ignore malformed cookie */ }
    }
    return cookies;
  }, {});
}

async function findUserByEmail(email) {
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

// Only these fields ever leave the server — never hashes, consent internals or session data.
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.created_at,
    marketingOptIn: !!user.marketing_opt_in,
    // True when the user has not accepted the current Terms (e.g. imported or after a Terms update).
    needsConsent: user.terms_version !== config.TERMS_VERSION || !user.age_confirmed_at
  };
}

function validatePassword(password) {
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (password.length > 200) throw new HttpError(400, 'Password is too long.');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, 'Password must include at least one letter and one number.');
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { handle };
