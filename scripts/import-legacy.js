'use strict';

// One-off import of accounts from the old file-based store (data/db.json) into Postgres.
// Usage: npm run db:import-legacy [path/to/db.json]
// Passwords keep their existing PBKDF2 hashes, so users sign in with the same password.
// Legacy users never accepted the current Terms, so consent is left empty and will be asked again.
require('./load-env');
const fs = require('fs');
const path = require('path');
const db = require('../lib/db');
const sec = require('../lib/security');
const validate = require('../lib/validate');

async function main() {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'db.json'));
  const legacy = JSON.parse(fs.readFileSync(file, 'utf8'));
  await db.ensureSchema();
  let imported = 0;
  for (const user of legacy.users || []) {
    const email = String(user.email || '').trim().toLowerCase();
    const { rowCount } = await db.query(
      `INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [user.id, user.name || email, email, user.password, user.createdAt || new Date().toISOString()]
    );
    if (!rowCount) { console.log(`skip ${email} (already exists)`); continue; }
    const doc = validate.userDoc({ ...(legacy.data || {})[user.id], profile: { ...((legacy.data || {})[user.id] || {}).profile, onboarded: true } });
    await db.withUser(user.id, c => c.query(
      'INSERT INTO user_data (user_id, doc_enc, revision, updated_at) VALUES ($1, $2, 1, now())',
      [user.id, sec.encryptJson(doc, `user_data:${user.id}`)]
    ));
    imported += 1;
    console.log(`imported ${email}`);
  }
  console.log(`Done. ${imported} account(s) imported.`);
  await db.getPool().end();
}

main().catch(err => { console.error(err); process.exit(1); });
