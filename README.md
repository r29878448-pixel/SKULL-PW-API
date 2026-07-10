# ⚡ SKULL PW API

Lightning fast video key extraction API deployable on Cloudflare Workers.

## Features

- 🚀 **Lightning Fast** - All requests run simultaneously
- 🔑 **Multi-Source** - Fetches from 4 video sources + token
- 🔐 **DRM Keys** - Extracts KID & ClearKey automatically
- 📊 **Admin Panel** - Manage AES keys/IVs via UI
- ☁️ **Cloudflare Workers** - Edge deployment

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Secrets

```bash
# Set Turso DB Token
wrangler secret put TURSO_DB_TOKEN
# Enter your token: eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...
```

### 3. Initialize Database

```bash
# Set environment variable first
export TURSO_DB_TOKEN="your_token_here"
npm run init-db
```

### 4. Deploy

```bash
npm run deploy
```

### 5. Local Development

```bash
npm run dev
```

## API Endpoints

### GET `/`
API Documentation

### GET `/admin`
Admin Panel to manage keys

### GET `/batchId={batchId}&childId={childId}`
Fetch video URL, KID, and ClearKey

**Example:**
```
/batchId=676e4dee1ec923bc192f38c9&childId=67fcb052fb1807f1d6e26bb6
```

**Response:**
```json
{
  "success": true,
  "source": "sdvbots",
  "videoUrl": "https://...master.mpd",
  "videoKey": "a89b2ac6-73da-4387-a3a8-eddc930073c8",
  "kid": "abc123...",
  "clearKey": "14827a5c417ca073c7b624b2f221efdc",
  "timeTaken": 245
}
```

### GET `/api/get-keys`
Get current AES keys from database

### POST `/api/update-keys`
Update AES keys (Admin only)

```json
{
  "key_name": "studystark_key",
  "key_value": "new_key_here"
}
```

## Sources

| Source | Type | Status |
|--------|------|--------|
| StudyStark | Encrypted (AES) | ✅ |
| RolexCoderZ | HTML Parse | ✅ |
| SDVBots | Direct JSON | ✅ |
| StudyTalk | Encrypted (AES) | ✅ |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TURSO_DB_URL` | Turso database URL |
| `TURSO_DB_TOKEN` | Turso auth token (secret) |

## License

MIT