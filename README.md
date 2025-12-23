# Nanovault

A lightweight Bitwarden-compatible server running on Cloudflare Workers.

## Features

### ✅ Supported

**Authentication & Account**
- Email verification registration flow (`/identity/accounts/register/finish`)
- JWT-based authentication with access/refresh token separation
- Password change with token invalidation
- Email change with verification token
- Prelogin KDF settings (PBKDF2 / Argon2)

**Vault Management**
- Full vault sync
- Cipher CRUD (Login, SecureNote, Card, Identity, SSH Key)
- Folder CRUD
- Bulk import (ciphers & folders)
- Soft delete / restore from trash
- Password history support

**Security**
- Server-side password hashing with salt
- Token type distinction (access vs refresh)
- Security stamp for token invalidation

**Storage**
- Cloudflare KV for user data
- Cloudflare R2 for encrypted vault storage
- Equivalent domains (global & custom)

**Mobile Push Notifications** (optional)
- Requires credentials from https://bitwarden.com/host/
- Works with official Bitwarden apps (App Store / Google Play only)
- Automatic sync on vault changes

### ❌ Not Supported

- Organizations / Sharing
- Two-factor authentication (2FA)
- Attachments upload/download
- Emergency access
- Send (secure sharing)
- WebAuthn / Passkeys
- Auth requests / Passwordless login
- Real-time sync via WebSocket (`/notifications/hub`)
- Email sending (self-hosted: tokens printed to console)

## Project Structure

```
src/
├── index.ts          # Router (~30 lines)
├── types.ts          # Type definitions
├── api/
│   ├── auth.ts       # Prelogin, Register, Token, Password/Email change
│   ├── sync.ts       # Sync, Profile
│   ├── ciphers.ts    # Cipher CRUD
│   ├── folders.ts    # Folder CRUD
│   └── config.ts     # Server config & stubs
├── storage/
│   ├── kv.ts         # KV operations
│   └── s3.ts         # R2/S3 operations
└── constants/
    └── domains.ts    # Global equivalent domains
```

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Cloudflare Resources**
   - **KV Namespace**: Create a namespace and update `wrangler.toml` with the ID.
     ```bash
     wrangler kv:namespace create DB
     ```
   - **R2 Bucket**: Create a bucket named `nanovault-storage` (or update `wrangler.toml`).
     ```bash
     wrangler r2 bucket create nanovault-storage
     ```

3. **Secrets**
   - Set the `JWT_SECRET` for signing tokens.
     ```bash
     wrangler secret put JWT_SECRET
     ```

## Development

```bash
# Run tests
npm test

# Start dev server
npm run dev
```

## Deployment

```bash
npm run deploy
```

## Client Configuration

Point your Bitwarden client (Self-hosted) to your worker URL: `https://nanovault.<your-subdomain>.workers.dev`

## API Endpoints

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/identity/accounts/prelogin` | POST | Get KDF parameters |
| `/identity/accounts/register/send-verification-email` | POST | Initiate registration |
| `/identity/accounts/register/finish` | POST | Complete registration |
| `/identity/connect/token` | POST | Login / Refresh token |
| `/api/accounts/password` | POST | Change password |
| `/api/accounts/email-token` | POST | Initiate email change |
| `/api/accounts/email` | POST | Complete email change |

### Vault

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sync` | GET | Full vault sync |
| `/api/ciphers` | POST | Create cipher |
| `/api/ciphers/:id` | GET/PUT/DELETE | Cipher CRUD |
| `/api/ciphers/import` | POST | Bulk import |
| `/api/folders` | POST | Create folder |
| `/api/folders/:id` | GET/PUT/DELETE | Folder CRUD |

### Settings

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/accounts/profile` | GET | User profile |
| `/api/accounts/revision-date` | GET | Vault revision date |
| `/api/settings/domains` | GET/PUT | Equivalent domains |
| `/api/config` | GET | Server configuration |
| `/health` | GET | Health check |