# Gurukul-AI
 
> AI-powered university document platform with semantic search, spaced-repetition study tools, classroom collaboration, and automated ingestion pipelines.

---

## Features

- **Document management** — upload PDF, DOCX, and PPTX files to personal or classroom spaces; exact SHA-256 deduplication and version history with content diff
- **AI assistant** — grounded Q&A with inline citations, quiz generation, and presentation generation powered by Gemini
- **Semantic + keyword search** — vector embeddings (768-dim) with Reciprocal Rank Fusion against full-text search; degrades gracefully to keyword-only
- **Study tools** — Leitner-style spaced repetition, quiz attempt history, weak-quiz review scheduling
- **Annotations** — anchored notes and replies on file units, persisted across adjacent versions by unit hash
- **Classroom collaboration** — professor-created classrooms with join codes; role-based file access and sharing controls
- **Classroom insights** — faculty analytics (topic aggregates, file usage); privacy-filtered by minimum distinct student count
- **Near-duplicate detection** — embedding-based cross-scope similarity flagging
- **Lifecycle & maintenance** — age-based archive rules, soft-delete trash with configurable retention, GC, and blob reference reconciliation
- **Direct uploads** — browser PUT to Neon Object Storage via presigned URLs with multipart fallback
- **Cost simulation** — hot/cold storage estimates on the dashboard (storage is not physically tiered)
- **Docker** — multi-service Compose setup with separate worker scaling

---

## Requirements

- Node.js 20.19+ or 22.12+
- Neon Postgres with the `vector` extension enabled
- Neon Object Storage bucket with S3-compatible credentials
- Gemini API key (for `gemini-embedding-2` and a generation model)

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env          # fill in DATABASE_URL, S3 creds, GEMINI_API_KEY, JWT_SECRET
cp client/.env.example client/.env   # set VITE_API_URL if needed (defaults to localhost:3000/api)

# 3. Verify external services
npm run check:env

# 4. Apply database migrations
npm run db:migrate

# 5. Start development (server + client hot-reload)
npm run dev
```

Open the Vite URL (default `http://localhost:5173`). Choose **Student** or **Professor** on the sign-in page and register. Professors create classrooms and share join codes; students join with those codes. Upload PDF, DOCX, or PPTX files; the ingestion worker indexes them automatically for search and AI retrieval.

> After pulling schema changes, always run `npm run db:migrate` before starting the server.

---

## Project Structure

```text
client/
  src/main.tsx             React routes, pages, API calls, and UI state
  src/style.css            application styles
  vite.config.ts           Vite + React configuration
  Dockerfile               Nginx-based static client image
  nginx.conf               SPA routing config

server/
  src/index.ts             Express setup, middleware, route mounts, job scheduling
  src/routes/              auth · classrooms · files · assistant · study · annotations · misc
  src/core/                permissions · storage · hash · diff · embed · llm · retrieval · analytics · logger · storage-cost · uploads
  src/parsers/index.ts     DOCX · PPTX · PDF text extraction
  src/jobs/                ingest · gc · lifecycle · reconcile
  src/jobs/queue.ts        durable PostgreSQL-backed ingestion queue
  src/worker.ts            embedded or standalone leased-job worker
  src/db/                  pool · schema · migrations (001–010) · migrate · seed
  src/check-env.ts         pre-flight environment checker
  scripts/
    setup-bucket-cors.ts   configure bucket CORS for direct uploads

tests/
  unit/core.test.ts        offline unit tests (hash, diff, etc.)
  integration/             isolated database integration tests

docs/
  TESTING.md               manual test workflows and verification notes

docker-compose.yml          API + worker + client services
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start server (`tsx watch`) + client (Vite) together |
| `npm run build` | Compile TypeScript server + build Vite client |
| `npm run start` | Run compiled production server |
| `npm run worker` | Run separate ingestion worker (dev, `tsx`) |
| `npm run start:worker` | Run compiled production worker |
| `npm run check:env` | Verify DB, storage, Gemini, and JWT config |
| `npm run db:migrate` | Apply all SQL migrations |
| `npm run seed` | Seed sample data |
| `npm run typecheck` | TypeScript check for server and client |
| `npm test` | Full test suite (unit + DB integration) |
| `npm run test:unit` | Offline unit tests only |
| `npm run setup:cors` | Configure bucket CORS for direct browser uploads |
| `npm run gc` | Run garbage collection job manually |
| `npm run reconcile` | Repair blob reference counters |
| `npm run lifecycle` | Run lifecycle archive rules manually |

---

## Architecture

```
Browser ──init/complete/search/assistant──► API ──metadata/retrieval──► Neon Postgres
   |                                         |                           (data + job queue)
   └─── presigned PUT ──────────────────►  Object Storage                     ▲
                                             ▲                                 │
                                             └──── objects + Gemini ◄── Worker(s)
```

- **API** — authenticates users, checks permissions, creates upload sessions, enqueues work
- **Object Storage** — receives file bytes directly from the browser via short-lived signed URLs
- **Workers** — claim jobs from Postgres; handle parsing, embedding, and indexing independently
- **Postgres** — stores all metadata, embeddings, job queue, quiz data, annotations, usage events

`WORKER_MODE=embedded` (default) runs the worker inside the API process. Set `WORKER_MODE=external` to run API and workers separately for scaled deployments.

---

## Docker

```bash
docker compose up --build
```

Compose reads the root `.env`. The API service runs without an embedded worker; a separate `worker` service handles ingestion. Scale workers with:

```bash
docker compose up --scale worker=2
```

The client is served by Nginx on port `8080`.

---

## Configuration

All settings are documented in `.env.example`. Key variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `AWS_ENDPOINT_URL_S3` | Neon Object Storage S3 endpoint |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Storage credentials |
| `S3_BUCKET` | Object storage bucket name |
| `GEMINI_API_KEY` | Google Gemini API key |
| `JWT_SECRET` | Secret for signing auth tokens |
| `LLM_MODEL` | Gemini generation model name |
| `EMBEDDING_MODEL` | Gemini embedding model (default: `gemini-embedding-2`) |
| `CLIENT_ORIGIN` | Allowed CORS origin(s), comma-separated |
| `WORKER_MODE` | `embedded` (default) or `external` |
| `DIRECT_UPLOAD` | Enable presigned browser uploads (default: `true`) |
| `ANALYTICS_MIN_USERS` | Min distinct students for topic aggregates (default: `3`) |

> **Never commit `.env`.** Use `.env.example` as a safe reference — it contains no credentials.

---

## Deployment

### Render / Railway (API + Worker)

1. Build: `npm install && npm run build`
2. Start API: `npm run start`
3. Start worker (separate service): `npm run start:worker` with `WORKER_MODE=external`
4. Set all variables from `.env.example` in the platform's secret settings
5. Set `CLIENT_ORIGIN` to the deployed frontend origin

### Vercel (Client)

1. Deploy the `client/` directory as a Vite app
2. Set `VITE_API_URL` to `https://your-api-host/api`
3. The `client/vercel.json` rewrite handles SPA routing

---

## Health Check

```
GET /api/health
```

Returns live status of database connectivity, auth/AI/storage configuration, worker mode, and queue depth. Use this to debug failed sign-in, uploads, or AI responses.

---

## Verification

See [docs/TESTING.md](docs/TESTING.md) for manual test workflows and current coverage notes.
