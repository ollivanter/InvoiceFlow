'use strict';

const crypto = require('crypto');
const business = require('../public/business.json');

const IS_PROD = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

// All secrets come from environment variables — never from source code. See .env.example.
function secret(name) {
  const value = process.env[name];
  if (value) return value;
  if (IS_PROD) throw new Error(`Missing required environment variable ${name}`);
  // Development only: derive a stable throwaway value so the app runs without setup.
  return crypto.createHash('sha256').update(`invoiceflow-dev-${name}`).digest('hex');
}

module.exports = {
  IS_PROD,
  business,
  DATABASE_URL: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  APP_URL: (process.env.APP_URL || '').replace(/\/$/, ''),
  get APP_SECRET() { return secret('APP_SECRET'); },
  get DATA_ENCRYPTION_KEY() { return secret('DATA_ENCRYPTION_KEY'); },

  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  MAIL_FROM: process.env.MAIL_FROM || `${business.productName} <onboarding@resend.dev>`,
  // Codes are shown in the browser only outside production, or when explicitly enabled for a demo.
  EXPOSE_DEV_CODES: !IS_PROD || process.env.OTP_DEMO === '1',

  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || '',
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || '',

  SESSION_COOKIE: IS_PROD ? '__Host-invoiceflow_session' : 'invoiceflow_session',
  SESSION_TTL_MS: 30 * 24 * 60 * 60 * 1000,
  OTP_TTL_MS: 10 * 60 * 1000,
  OTP_RESEND_MS: 30 * 1000,
  OTP_MAX_ATTEMPTS: 5,
  MAX_BACKUPS_PER_USER: 30,
  AUTO_BACKUP_INTERVAL_MS: 10 * 60 * 1000,
  JSON_LIMIT: 64 * 1024,
  // Vercel functions accept request bodies up to 4.5 MB.
  SYNC_LIMIT: 4 * 1024 * 1024,
  TERMS_VERSION: business.legal.termsVersion,
  MIN_AGE: business.legal.minimumAge
};
