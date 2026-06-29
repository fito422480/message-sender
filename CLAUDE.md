# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WhatsApp bulk message sender with multi-tenant support. Node.js 20+ Express backend with Baileys WebSocket library, PostgreSQL 16, Redis 7.2 + BullMQ queues, Firebase Auth, and a vanilla JS frontend. Deployed to Kubernetes via GitHub Actions CI/CD.

## Commands

```bash
npm run dev              # Start dev server with nodemon
npm start                # Production: node app.js
npm run docker:compose   # docker-compose up -d (starts app + Redis + PostgreSQL)
npm run docker:logs      # View container logs
npm run reset-auth       # Clear Baileys auth state

# Debugging scripts
node scripts/check-queue.js   # BullMQ queue status
node scripts/job-logs.js      # Job execution logs
node scripts/remove-job.js    # Remove jobs from queue
```

No automated test suite exists. Manual testing via `test-audio.js` and scripts in `scripts/`.

## Architecture

**Single Express app** (not a monorepo). Entry point: `app.js` → mounts routes from `src/routes.js`.

### Backend (`src/`)

| File | Role |
|---|---|
| `routes.js` | All REST endpoints (contacts CRUD, campaigns, dashboard analytics, chatbot config, inbox, connection status) |
| `manager.js` | `WhatsAppManager` — Baileys socket, QR generation, reconnection, rate limiting (15 msgs/min) |
| `sessionManager.js` | Per-user WhatsApp session lifecycle, multi-pod owner heartbeat via Redis |
| `queueRedis.js` | BullMQ worker (`ms:messages` queue), message processing with retries, campaign progress tracking |
| `chatbotEngine.js` | Chatbot flow engine, AI integration (OpenAI etc.), conversation state, message routing, API key encryption/decryption |
| `auth.js` | Firebase ID token verification via `firebase-admin`. Bypassed in development (mock user) |
| `metricsStore.js` | Uses Firestore (`metricsStoreFirestore.js`) when Firebase Admin is available; PostgreSQL is fallback |
| `postgresClient.js` | Connection pool (size 10), slow query logging (>1s) |
| `redisClient.js` | ioredis singleton via `getRedis()` |
| `media.js` | Multer upload + FFmpeg audio conversion (AAC, 64k, 16kHz, mono) |
| `utils.js` | File cleanup, Paraguayan phone normalization (→ `595XXXXXXXXX`), CSV parsing |
| `phoneValidator.js` | Multi-country phone number validation and normalization |
| `apiV1Routes.js` | Public API v1 routes (token auth, send messages, bulk send, webhooks) |
| `firebaseAdmin.js` | Firebase Admin SDK initialization for authentication |
| `stores/redisAuthState.js` | Baileys auth state persistence in Redis for multi-pod |

### Frontend (`public/js/`)

Vanilla JS modules with Bootstrap 5. Polls `/connection-status` every 15s for WhatsApp state. Modules: `core.js` (config), `main.js` (init), `whatsapp.js` (connection), `messages.js` (sending), `contacts.js` (CRUD), `dashboard.js` (analytics), `chatbot.js` (chatbot flow editor & config), `inbox.js` (incoming messages & replies), `campaigns.js` (campaign history & responses), `plans.js` (subscription plans), `api.js` (API key management & docs), `admin.js` (admin panel), `templates.js` (message templates).

### Database (`db/init/01-schema.sql`)

Firestore is the primary persistence layer for contacts, campaigns, metrics, templates, chatbot configs/nodes/conversations, and incoming messages. PostgreSQL tables in `db/init/01-schema.sql` are retained as fallback schema for environments without Firebase.

### Infrastructure

- **Docker**: Multi-stage build on `node:20-bullseye-slim` with ffmpeg
- **Kubernetes** (`k8s/`): Deployment + HPA, KEDA scale-to-zero, Ingress with cert-manager, PostgreSQL StatefulSet
- **CI/CD** (`.github/workflows/deploy.yml`): Push to main → test → Docker build → GHCR → kubectl apply
- Health endpoints: `GET /health` (liveness), `GET /ready` (readiness)

## Code Conventions

- **Logging**: Always use `require('./logger')` (pino) with structured context objects. Never `console.log`.
- **Redis access**: Always via `getRedis()` singleton from `redisClient.js`. Check status before use.
- **PostgreSQL**: Use pool from `postgresClient.js`, never create direct connections.
- **Phone numbers**: Normalize to Paraguayan format `595XXXXXXXXX` (12 digits) via `normalizeParaguayanNumber()`.
- **Auth**: JWT required in production. In development (`NODE_ENV !== 'production'`), a mock user is injected.
- **WhatsApp**: Handle `DisconnectReason` properly. Respect 15 msgs/min rate limit. Auth state persists in Redis.
- **File handling**: User-scoped file names (include userId). Auto-cleanup based on retention hours.

## Baileys Known Issues & Workarounds

- **Version**: `@whiskeysockets/baileys@7.0.0-rc.9`. Uses CommonJS require (not ESM).
- **405 Connection Failure (active ~Feb 2026)**: WhatsApp rejects `Platform.WEB`. Workaround: pass `version: [2, 3000, 1033893291]` in `makeWASocket()` config. Pending fix: Baileys PR #2365 (use `Platform.MACOS`).
- **QR not generated with stale auth**: Baileys never generates QR when stored credentials exist — it tries to reconnect. Method `cleanInitialize()` in `WhatsAppManager` clears Redis auth via `_clearRedisAuth()` and creates a fresh socket. Used by `/qr` endpoint when no socket exists.
- **Socket close event race condition**: When destroying old socket, MUST call `ev.removeAllListeners()` BEFORE closing, otherwise the close handler destroys the new socket.
- **`_deleteSessionFilesCompletely` fallback**: Uses `_clearRedisAuth()` when `_clearAuth` is null (session never initialized on current pod).
- **440 Stream Conflict loop**: statusCode 440 means WhatsApp sees two simultaneous connections for the same linked device. DO NOT clear Redis auth on this error — doing so forces a new QR scan and a new device link without removing the old one, guaranteeing another 440 on the next attempt (infinite loop with escalating cooldowns). The correct response is to reconnect with the existing credentials and wait for the competing session to drop. Recovery for the user: on the phone go to WhatsApp → Linked Devices → remove all, then restart the server. `GET /qr` has a 60 s rate limit on `cleanInitialize()`; call `POST /reset-cooldown` to unblock if stuck.

## Key Environment Variables

Core: `PORT`, `NODE_ENV`. Auth/persistence: `FIREBASE_SERVICE_ACCOUNT` (base64-encoded service-account JSON) or `GOOGLE_APPLICATION_CREDENTIALS` (file path). Redis: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (or `REDIS_URL`). PostgreSQL fallback: `POSTGRES_HOST/PORT/USER/PASSWORD/DB`. S3/MinIO: `MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET`. Chatbot: `CHATBOT_ENCRYPTION_KEY` (32-byte hex key for AES-256 encryption of AI API keys). See `.env.example` for full list.
