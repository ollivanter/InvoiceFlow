'use strict';

const { Pool } = require('pg');
const config = require('./config');

const APP_ROLE = 'invoiceflow_app';

// One pool per serverless instance; kept small because Vercel may run many instances.
let pool;
function getPool() {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL is not set. See .env.example.');
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000
    });
    pool.on('error', err => console.error('[db] idle client error', err.message));
  }
  return pool;
}

// All queries use $1-style parameters; user input is never concatenated into SQL.
function query(text, params) {
  return getPool().query(text, params);
}

let rlsRoleAvailable = false;

/**
 * Runs `fn` in a transaction that can only see rows owned by `userId`.
 * Row-level security policies on user_data and backups compare against app.user_id, and the
 * transaction switches to a role without BYPASSRLS so the policies are enforced even if the
 * connection role is the table owner.
 */
async function withUser(userId, fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (rlsRoleAvailable) await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  terms_version text,
  terms_accepted_at timestamptz,
  age_confirmed_at timestamptz,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS user_data (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doc_enc text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz,
  last_backup_at timestamptz
);

CREATE TABLE IF NOT EXISTS backups (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  doc_enc text NOT NULL,
  invoice_count integer NOT NULL DEFAULT 0,
  client_count integer NOT NULL DEFAULT 0,
  size_bytes integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS backups_user_idx ON backups(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS otps (
  key text PRIMARY KEY,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  reset_at timestamptz NOT NULL
);

ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_data FORCE ROW LEVEL SECURITY;
ALTER TABLE backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE backups FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_data' AND policyname = 'user_data_owner') THEN
    CREATE POLICY user_data_owner ON user_data
      USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
      WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'backups' AND policyname = 'backups_owner') THEN
    CREATE POLICY backups_owner ON backups
      USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
      WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
  END IF;
END $$;
`;

const ROLE_SETUP = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    CREATE ROLE ${APP_ROLE} NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT ${APP_ROLE} TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON user_data, backups TO ${APP_ROLE};
GRANT SELECT ON users TO ${APP_ROLE};
GRANT USAGE, SELECT ON SEQUENCE backups_id_seq TO ${APP_ROLE};
`;

let ready;
function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(724011)');
        await client.query(SCHEMA);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      try {
        await query(ROLE_SETUP);
        rlsRoleAvailable = true;
      } catch (error) {
        console.warn(`[db] could not set up ${APP_ROLE} role (${error.message}); RLS relies on FORCE ROW LEVEL SECURITY only.`);
      }
    })().catch(error => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

// Expired rows are pruned opportunistically instead of with a cron job.
async function maybeCleanup() {
  if (Math.random() > 0.02) return;
  await query(`
    DELETE FROM sessions WHERE expires_at < now();
    DELETE FROM otps WHERE expires_at < now();
    DELETE FROM rate_limits WHERE reset_at < now();
  `).catch(err => console.warn('[db] cleanup failed', err.message));
}

module.exports = { query, withUser, ensureSchema, maybeCleanup, getPool };
