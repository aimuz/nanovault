# Nanovault

A lightweight Bitwarden-compatible server running on Cloudflare Workers.

## Features

- **Modular Architecture**: Clean separation of concerns with dedicated modules for auth, sync, ciphers, and folders
- **Storage**: Uses Cloudflare KV for user data/indices and R2 for encrypted vault storage
- **Authentication**: JWT-based authentication compatible with Bitwarden clients
- **Vault Sync**: Full vault synchronization with cipher and folder CRUD operations
- **Attachments**: File attachment support via R2 storage

## Project Structure

```
src/
├── index.ts          # Router (~30 lines)
├── types.ts          # Type definitions
├── api/
│   ├── auth.ts       # Prelogin, Register, Token
│   ├── sync.ts       # Sync, Profile
│   ├── ciphers.ts    # Cipher CRUD
│   ├── folders.ts    # Folder CRUD
│   └── config.ts     # Server config & stubs
└── storage/
    ├── kv.ts         # KV operations
    └── s3.ts         # R2/S3 operations
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

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/accounts/prelogin` | POST | Get KDF parameters |
| `/api/accounts/register` | POST | Register new user |
| `/identity/connect/token` | POST | Login / Refresh token |
| `/api/sync` | GET | Full vault sync |
| `/api/ciphers` | POST | Create cipher |
| `/api/ciphers/:id` | GET/PUT/DELETE | Cipher CRUD |
| `/api/folders` | POST | Create folder |
| `/api/folders/:id` | GET/PUT/DELETE | Folder CRUD |
| `/api/config` | GET | Server configuration |
| `/health` | GET | Health check |