const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SESSION_COOKIE = 'invoiceflow_session';
const SESSION_DAYS = 30;
const MAX_BACKUPS_PER_USER = 100;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

ensureStorage();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`InvoiceFlow running at http://localhost:${PORT}`);
});

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    writeDb({ users: [], sessions: [], data: {} });
  }
}

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    return register(req, res);
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    return login(req, res);
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    return logout(req, res);
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const auth = getAuth(req);
    return sendJson(res, 200, { user: auth ? publicUser(auth.user) : null });
  }
  if (req.method === 'GET' && url.pathname === '/api/sync') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    return getSync(res, auth.user.id);
  }
  if (req.method === 'PUT' && url.pathname === '/api/sync') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    return putSync(req, res, auth.user.id);
  }
  if (req.method === 'GET' && url.pathname === '/api/backups') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    return listBackups(res, auth.user.id);
  }
  if (req.method === 'POST' && url.pathname === '/api/backups/restore') {
    const auth = requireAuth(req, res);
    if (!auth) return;
    return restoreBackup(req, res, auth.user.id);
  }
  sendJson(res, 404, { error: 'Not found' });
}

async function register(req, res) {
  const body = await readBody(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  if (!name) return sendJson(res, 400, { error: 'Name is required' });
  if (!isEmail(email)) return sendJson(res, 400, { error: 'Valid email is required' });
  if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters' });

  const db = readDb();
  if (db.users.some(user => user.email === email)) {
    return sendJson(res, 409, { error: 'An account already exists for this email' });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    password: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  db.data[user.id] = { profile: {}, invoices: [], updatedAt: new Date().toISOString() };
  const session = createSession(user.id);
  db.sessions.push(session);
  writeDb(db);
  createBackup(user.id, db.data[user.id]);
  setSessionCookie(res, session.token);
  sendJson(res, 201, { user: publicUser(user), data: db.data[user.id] });
}

async function login(req, res) {
  const body = await readBody(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const db = readDb();
  const user = db.users.find(candidate => candidate.email === email);
  if (!user || !verifyPassword(password, user.password)) {
    return sendJson(res, 401, { error: 'Invalid email or password' });
  }
  db.sessions = db.sessions.filter(session => !isExpired(session));
  const session = createSession(user.id);
  db.sessions.push(session);
  writeDb(db);
  setSessionCookie(res, session.token);
  sendJson(res, 200, { user: publicUser(user), data: db.data[user.id] || emptyData() });
}

function logout(req, res) {
  const token = getCookies(req)[SESSION_COOKIE];
  const db = readDb();
  db.sessions = db.sessions.filter(session => session.token !== token);
  writeDb(db);
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

function getSync(res, userId) {
  const db = readDb();
  sendJson(res, 200, db.data[userId] || emptyData());
}

async function putSync(req, res, userId) {
  const body = await readBody(req, 2_000_000);
  const profile = isPlainObject(body.profile) ? body.profile : {};
  const invoices = Array.isArray(body.invoices) ? body.invoices : [];
  const data = {
    profile,
    invoices,
    updatedAt: new Date().toISOString()
  };
  const db = readDb();
  db.data[userId] = data;
  writeDb(db);
  createBackup(userId, data);
  sendJson(res, 200, data);
}

function listBackups(res, userId) {
  const dir = backupPath(userId);
  const backups = fs.existsSync(dir)
    ? fs.readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .sort()
      .reverse()
      .map(file => ({ id: file.replace(/\.json$/, ''), createdAt: fileToIso(file) }))
    : [];
  sendJson(res, 200, { backups });
}

async function restoreBackup(req, res, userId) {
  const body = await readBody(req);
  const id = String(body.id || '').replace(/[^0-9TZ.-]/g, '');
  if (!id) return sendJson(res, 400, { error: 'Backup id is required' });
  const file = path.join(backupPath(userId), `${id}.json`);
  if (!file.startsWith(backupPath(userId)) || !fs.existsSync(file)) {
    return sendJson(res, 404, { error: 'Backup not found' });
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const db = readDb();
  db.data[userId] = {
    profile: isPlainObject(data.profile) ? data.profile : {},
    invoices: Array.isArray(data.invoices) ? data.invoices : [],
    updatedAt: new Date().toISOString()
  };
  writeDb(db);
  createBackup(userId, db.data[userId]);
  sendJson(res, 200, db.data[userId]);
}

function getAuth(req) {
  const token = getCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const db = readDb();
  const session = db.sessions.find(candidate => candidate.token === token);
  if (!session || isExpired(session)) return null;
  const user = db.users.find(candidate => candidate.id === session.userId);
  return user ? { user, session } : null;
}

function requireAuth(req, res) {
  const auth = getAuth(req);
  if (!auth) sendJson(res, 401, { error: 'Not authenticated' });
  return auth;
}

function createSession(userId) {
  return {
    token: crypto.randomBytes(32).toString('hex'),
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  };
}

function isExpired(session) {
  return new Date(session.expiresAt).getTime() <= Date.now();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 210000;
  const digest = 'sha512';
  const key = crypto.pbkdf2Sync(password, salt, iterations, 64, digest).toString('hex');
  return `pbkdf2$${digest}$${iterations}$${salt}$${key}`;
}

function verifyPassword(password, stored) {
  const [kind, digest, iterations, salt, key] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !digest || !iterations || !salt || !key) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, Number(iterations), 64, digest);
  const expected = Buffer.from(key, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function createBackup(userId, data) {
  const dir = backupPath(userId);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/:/g, '-');
  fs.writeFileSync(path.join(dir, `${stamp}.json`), JSON.stringify(data, null, 2));
  pruneBackups(dir);
}

function pruneBackups(dir) {
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.json')).sort();
  const extra = files.length - MAX_BACKUPS_PER_USER;
  if (extra <= 0) return;
  files.slice(0, extra).forEach(file => fs.unlinkSync(path.join(dir, file)));
}

function backupPath(userId) {
  return path.join(BACKUP_DIR, userId);
}

function fileToIso(file) {
  return file.replace(/\.json$/, '').replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
}

async function readBody(req, limit = 100000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, requested));
  const insideRoot = filePath === ROOT || filePath.startsWith(ROOT + path.sep);
  if (!insideRoot || filePath.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=300'
    });
    res.end(content);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function getCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((cookies, part) => {
    const [key, ...value] = part.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(value.join('='));
    return cookies;
  }, {});
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function emptyData() {
  return { profile: {}, invoices: [], updatedAt: null };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
