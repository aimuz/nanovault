# NanoVault

A lightweight Bitwarden-compatible server running on Cloudflare Workers.

## Features

### ✅ Supported

- **Authentication**: Email verification registration, JWT tokens with refresh support, password/email change
- **Vault**: Full sync, cipher CRUD (Login, SecureNote, Card, Identity, SSH Key), folder CRUD, bulk import, soft delete/restore
- **Security**: Server-side password hashing, security stamp for token invalidation
- **Storage**: Cloudflare KV + R2, equivalent domains (global & custom)
- **Email**: Sending via [Resend](https://resend.com) (optional)
- **Push Notifications** (optional): Mobile app sync via Bitwarden relay service

### ❌ Not Supported

- Organizations / Sharing
- Two-factor authentication (2FA)
- Attachments
- Emergency access
- Send (secure sharing)
- WebAuthn / Passkeys
- Passwordless login
- Real-time WebSocket sync

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Cloudflare Resources**
   ```bash
   wrangler kv:namespace create DB
   wrangler r2 bucket create nanovault-storage
   wrangler secret put JWT_SECRET
   ```

3. **Update `wrangler.toml`** with your KV namespace ID

## Development

```bash
npm test        # Run tests
npm run dev     # Start dev server
npm run deploy  # Deploy to Cloudflare
```

## Client Configuration

Point your Bitwarden client (Self-hosted) to: `https://nanovault.<your-subdomain>.workers.dev`

## Push Notifications (Optional)

1. Get credentials from https://bitwarden.com/host/
2. Configure in `wrangler.toml`:
   ```toml
   [vars]
   PUSH_ENABLED = "true"
   PUSH_INSTALLATION_ID = "your-id"
   PUSH_INSTALLATION_KEY = "your-key"
   ```

> ⚠️ Only works with official App Store / Google Play Bitwarden apps

## Roadmap

- [x] Email sending via [Resend](https://resend.com)
- [ ] Two-factor authentication (2FA)
- [ ] Attachments support
- [ ] WebSocket real-time sync
