# Meridian International Bank — Digital Banking Platform

A full-stack international digital banking web application built with Node.js, Express, TypeScript, React, Tailwind CSS, and an external **MySQL** database (`mysql2`), featuring a double-entry financial ledger, multi-currency wallets, private AES-256-GCM KYC document custody, tokenized card controls, and a role-based Administrator Console.

> **Institutional Notice**: This software implements a banking ledger, customer portal, and partner integration architecture. Account issuance, deposit clearing, external wire settlement, card issuance, and live FX feeds operate exclusively through authorized, licensed partners when configured via environment variables.

---

## Architecture Overview

- **Frontend (`/src/`)**: Responsive React + TypeScript + Tailwind CSS application with Light/Dark mode, 16 public banking & legal pages, Customer Banking Dashboard (`/dashboard`), and separate Administrator Console (`/admin`).
- **Backend (`/backend/` & `/server.ts`)**: Express REST API with Helmet security headers, rate limiting, CSRF origin verification, HTTP-only secure cookies + Bearer JWT sessions, Zod validation, bcrypt password hashing, RFC 6238 TOTP 2FA, and HMAC-verified webhooks.
- **Database (`/database/`)**: MySQL 8.0+ relational schema (`schema.sql`), incremental migrations (`migrations/`), development seed script (`seed.ts`), and secure CLI initial admin provisioning (`create-admin.ts`).
- **Financial Core**: Double-entry ledger (`ledger_transactions`, `ledger_entries`, `ledger_accounts`) using exact `DECIMAL(19, 4)` arithmetic (`BigInt` scaled integers in Node.js), `SELECT ... FOR UPDATE` row locking, idempotency keys, and compensating reversals.

---

## Environment Variables (`.env.example`)

Copy `.env.example` to `.env` for local development or enter these variables in the Render dashboard.

### Required for Production
| Variable | Description |
| :--- | :--- |
| `NODE_ENV` | Set to `production` on Render. |
| `PORT` | Server port (Render injects `PORT` automatically; defaults to `3000`). |
| `PUBLIC_URL` | Full public HTTPS URL of the Render Web Service (e.g., `https://your-bank.onrender.com`). |
| `MYSQL_HOST` | Hostname of your externally hosted MySQL 8+ server. |
| `MYSQL_PORT` | MySQL port (typically `3306` or provider-assigned port). |
| `MYSQL_USER` | MySQL username. |
| `MYSQL_PASSWORD` | MySQL password. |
| `MYSQL_DATABASE` | Target MySQL database/schema name. |
| `MYSQL_SSL` | Set to `true` when connecting to cloud MySQL over TLS/SSL. |
| `SESSION_SECRET` | Random 64-character hex string for session signing. |
| `JWT_SECRET` | Random 64-character hex string for JWT token signing. |
| `ENCRYPTION_KEY` | Random 64-character hex string for AES-256-GCM encryption of TOTP secrets & KYC files. |

### Optional / Integration Variables
| Variable | Description |
| :--- | :--- |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | `true` (default) to verify server TLS certificate; set `false` only if provider uses self-signed certs without CA. |
| `MYSQL_SSL_CA` | Optional PEM-encoded CA certificate (use `\n` for newlines). |
| `ADMIN_INITIAL_EMAIL` | Optional email used by `npm run create-admin`. |
| `ADMIN_SETUP_TOKEN` | Optional secret token required to claim the first Super Admin via `/admin` UI. |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD`, `EMAIL_FROM` | SMTP settings for transactional & security emails. |
| `BANKING_PARTNER_PROVIDER`, `BANKING_PARTNER_API_KEY`, `BANKING_PARTNER_WEBHOOK_SECRET` | External domestic/international wire partner adapter credentials. |
| `PAYMENT_PROVIDER`, `PAYMENT_API_KEY`, `PAYMENT_WEBHOOK_SECRET` | Deposit payment gateway adapter & HMAC webhook secret. |
| `FX_PROVIDER`, `FX_API_KEY` | Authorized live FX rate provider. |
| `CARD_ISSUER_PROVIDER`, `CARD_ISSUER_API_KEY`, `CARD_ISSUER_WEBHOOK_SECRET` | Tokenized card issuer credentials. |
| `KYC_PROVIDER`, `KYC_PROVIDER_API_KEY` | External identity verification provider (defaults to `internal_review`). |
| `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_FROM` | Optional SMS notification provider. |
| `PRIVATE_STORAGE_DIR` | Optional private filesystem path outside public web root for encrypted KYC files (defaults to `encrypted_db`). |

---

## Deploying to Render (Step-by-Step)

Render does not automatically provision an external MySQL database; connect your externally hosted MySQL server (e.g., Aiven, DigitalOcean Managed MySQL, AWS RDS, Railway, or Clever Cloud) via environment variables.

1. **Export the Project**: Download/export the project archive (`.zip`) from AI Studio or push the codebase to your private GitHub/GitLab repository.
2. **Create a Render Web Service**: Log in to Render, click **New +** -> **Web Service**.
3. **Connect Source Repository**: Select your Git repository (or upload the extracted source to a Git repo connected to Render) and choose **Node** as the runtime.
4. **Configure Build Command**:
   ```bash
   npm install && npm run build
   ```
5. **Configure Start Command**:
   ```bash
   npm start
   ```
   *(This executes `node dist/server.mjs`, serving both the Express REST API and the built React frontend from the same origin on `process.env.PORT`.)*
6. **Enter MySQL & Security Environment Variables**: In Render's **Environment** tab, add `NODE_ENV=production`, `PUBLIC_URL`, `SESSION_SECRET`, `JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_SETUP_TOKEN`, and your external `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE`.
7. **Configure SSL Database Access**: Set `MYSQL_SSL=true`. If your MySQL host provides a CA certificate, paste its contents into `MYSQL_SSL_CA` and keep `MYSQL_SSL_REJECT_UNAUTHORIZED=true`.
8. **Run Database Migrations**: Using Render Shell (or locally pointing `.env` at your external MySQL server), run:
   ```bash
   npm run migrate
   ```
9. **Create the Initial Administrator Securely**:
   - **Option A (CLI)**: Run `npm run create-admin` in Render Shell (or locally against the remote DB) and save the generated TOTP authenticator secret/QR URI.
   - **Option B (First-Run UI Claim)**: Visit `https://<your-service>.onrender.com/admin`. When zero administrator rows exist in `admin_users`, the one-time Super Administrator provisioning form appears (protected by `ADMIN_SETUP_TOKEN` if set) and locks permanently once claimed.
10. **Verify the Deployment**:
    - Check `https://<your-service>.onrender.com/health` — verify `"status": "ok"` and `"database": { "configured": true, "connected": true }`.
    - Open `https://<your-service>.onrender.com/` to verify the public website, `/register` to test onboarding, and `/admin` to access the Administrator Console.

---

## Running Automated Tests

Run the test suite covering exact monetary math, double-entry ledger balancing, idempotency, authentication, KYC encryption, deposit/withdrawal workflows, RBAC, and webhook HMAC signatures:

```bash
npm test
```
