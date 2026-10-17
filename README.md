# InvoiceFlow

Invoicing SaaS: branded invoices, clients, products, dashboard, encrypted cloud sync with versioned backups. Static frontend in `public/` + a single Vercel Function (`api/index.js`) backed by Postgres (Neon).

## Deploy to Vercel

1. **Database** — create a Neon Postgres database (or use Vercel's Neon integration). Copy the **pooled** connection string.
2. **Environment variables** (Vercel → Project → Settings → Environment Variables):

   | Variable | Required | Notes |
   |---|---|---|
   | `DATABASE_URL` | yes | Neon pooled URL with `sslmode=require` |
   | `APP_SECRET` | yes | `openssl rand -base64 32` — signs OTPs and unsubscribe links |
   | `DATA_ENCRYPTION_KEY` | yes | `openssl rand -base64 32` — encrypts business data at rest. **Back it up; losing it makes data unreadable.** |
   | `APP_URL` | yes | e.g. `https://invoiceflow.example.com` (used in email links) |
   | `RESEND_API_KEY`, `MAIL_FROM` | yes for real users | Verification/reset emails via [Resend](https://resend.com) with a verified domain |
   | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | optional | Cloudflare Turnstile bot protection |

3. **Deploy** — import the repo in Vercel (framework preset: *Other*). `vercel.json` serves `public/`, routes `/api/*` to the function, and sets security headers. The schema is created automatically on first request (or run `npm run db:migrate` locally against the same `DATABASE_URL`).
4. **Business details** — edit `public/business.json` (legal name, address, registration/tax IDs, contact and privacy emails, governing law). They appear in the footer, legal pages and emails.
5. **Legal review** — `public/legal/*.html` are starting templates written for how this app works. Have them reviewed by a lawyer for your jurisdiction before launch.

## Local development

```bash
docker run -d --name invoiceflow-pg -e POSTGRES_USER=invoiceflow -e POSTGRES_PASSWORD=invoiceflow -e POSTGRES_DB=invoiceflow -p 5432:5432 postgres:16-alpine
cp .env.example .env          # DATABASE_URL already points at the container above
npm install
npm run dev                   # http://localhost:3000
```

Without `RESEND_API_KEY`, verification codes are printed to the server console and shown in the browser (development only — never in production unless `OTP_DEMO=1`).

Import accounts from the old file-based version: `npm run db:import-legacy data/db.json` (users keep their passwords and are asked to accept the Terms on next sign-in).

## Security & compliance overview

- **Auth:** PBKDF2-SHA512 passwords, email OTP (hashed, single-use, 5 attempts, 10-min expiry), session tokens stored only as SHA-256 hashes, `__Host-` HttpOnly/Secure/SameSite cookies, sessions revoked on password reset/change.
- **Abuse:** Postgres-backed rate limits on login/OTP/reset/register, honeypot + optional Turnstile, generic errors and constant-time checks against account enumeration.
- **Data:** AES-256-GCM encryption of business data and backups (bound to the owner), Postgres row-level security on `user_data`/`backups` enforced through a non-`BYPASSRLS` role, server-side schema whitelisting (no mass assignment), parameterized queries only.
- **Web:** strict CSP (no inline scripts, no third-party scripts except optional Turnstile), HSTS, frame/referrer/permissions policies, same-origin check on mutations, all user content HTML-escaped, logos re-encoded client-side and signature-checked server-side (no SVG).
- **Privacy:** self-hosted OFL fonts (no Google requests), essential-only storage with an informational cookie notice, unticked Terms/age/marketing consents recorded server-side, one-click unsubscribe (RFC 8058), self-serve JSON export and immediate account deletion.
- **Supply chain:** one runtime dependency (`pg`), `npm audit` in CI, Dependabot.

## Scripts

`npm run dev` · `npm run check` (syntax) · `npm run audit` · `npm run db:migrate` · `npm run db:import-legacy`
