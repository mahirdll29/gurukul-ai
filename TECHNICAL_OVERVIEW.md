# Gurukul-AI: Technical Overview

## Stack at a glance

| Area | Technologies |
|---|---|
| Runtime and language | Node.js (20.19+ or 22.12+ per README), TypeScript, ES modules |
| API | Express 5, CORS, JSON API, `tsx` for development and scripts |
| Database | Neon-hosted PostgreSQL, `pg`, `vector` extension, SQL migrations |
| Object storage | Neon Object Storage through its S3-compatible API, AWS SDK v3 and signed URLs |
| Web client | React 19, React Router 7, Vite 7, TypeScript, Tailwind CSS 3 |
| Authentication | `bcryptjs` password hashes and `jsonwebtoken` bearer tokens |
| Parsing | `jszip` and `fast-xml-parser` for DOCX/PPTX; `pdfjs-dist` for PDF text extraction |
| AI | Gemini REST API called with `fetch` for embeddings and text/JSON generation |
| Diff and generated files | `diff` array comparison; `pptxgenjs` for generated presentations |
| Automated tests | Vitest unit tests and isolated PostgreSQL integration tests |
| Containers | Dockerfiles for API/worker and Nginx client; Docker Compose |
| Hosting direction | API on Render or Railway; client on Vercel (see README) |

The project intentionally uses plain `fetch` and React state for client API calls. The current client UI is primarily implemented in `client/src/main.tsx`, with styling in `client/src/style.css`.

## Structure

```text
client/
  src/main.tsx             React routes, pages, API calls, and UI state
  src/style.css            application styles
  vite.config.ts           Vite React configuration
server/
  src/index.ts             Express setup, health endpoint, jobs, error handling
  src/routes/              auth, classrooms, files, assistant, and misc endpoints
  src/core/                permissions, storage, hashes, diffs, embeddings, LLM
  src/parsers/index.ts     DOCX, PPTX, and PDF extraction into units
  src/jobs/                ingestion, garbage collection, lifecycle, reconciliation
  src/jobs/queue.ts        durable PostgreSQL ingestion queue
  src/worker.ts            embedded or separate leased-job worker
  src/db/                  pool, schema, migrations, seed, migration runner
tests/                     offline unit tests and isolated database tests
docs/                      testing and demonstration notes
```

## Web client

The Vite app has portal and feature routes for student/professor home, classroom views, personal/classroom file spaces, file detail and preview, search, assistant, study review, dashboard, and trash. It calls the backend through a small `request()` helper that adds JSON headers and the `Authorization: Bearer …` token. The API base URL comes from `VITE_API_URL`; development defaults to `http://localhost:3000/api`.

The client keeps authentication state in browser `localStorage`, restores the session with `/auth/me`, and uses React Router for navigation. Vite is configured with `resolve.preserveSymlinks` for this Windows workspace.

## API and service boundaries

`server/src/index.ts` configures CORS, JSON parsing, security-related response headers, health reporting, route mounts, PDF streaming, and centralized error responses. The server reads secrets and service configuration from environment variables; `.env.example` documents the expected names without credentials.

Main route groups:

- `/api/auth` — registration, login, and current-user lookup.
- `/api/classrooms` — classroom listing/creation/joining and membership data.
- `/api/files` — upload/list/detail, preview/download, versions and diff/lineage, archive/trash/restore, lifecycle rules, quiz read, and related file actions.
- `/api/assistant` — indexed-file library, grounded question answering, quiz generation, presentation generation, and quiz retrieval.
- `/api/files/uploads/init`, `/api/files/uploads/:id/complete` — direct upload session init/verification; multipart `/api/files` remains available.
- `/api/files/:fileId/versions/:versionId/job` and `/retry` — ingestion job state and retry.
- `/api/quizzes/:fileId/attempts`, `/api/study/*` — quiz grading, history, review scheduling, and weak quiz groups.
- `/api/files/:fileId/versions/:versionId/annotations` and `/api/annotations/*` — anchored notes, replies, and resolution.
- `/api/classrooms/:id/analytics` — faculty-only privacy-filtered insights.
- `/api/ops/metrics` — professor-only ingestion queue and worker metrics.
- Other `/api` routes — hybrid/name search, storage stats, trash listing, and duplicate dismissal.
- `/api/health` — reports database connectivity, auth/AI/storage configuration, worker mode, and queue depth.
- `/api/stream/:fileId` — authenticated PDF streaming path used by the client.

Bearer tokens identify the user. Permission helpers in `server/src/core/permissions.ts` resolve that identity and check personal ownership or classroom membership/role before file access. Retrieval SQL applies corresponding access constraints before candidate document text is returned to application code.

## Data model and persistence

`server/src/db/schema.sql` defines the main entities. In broad terms:

- `users`, `orgs`, and `memberships` represent accounts, classrooms, and student/faculty roles.
- `files` are named records in either personal or classroom ownership scopes.
- `file_versions` track uploaded/generated revisions and processing state.
- `blobs` refer to immutable object-storage objects by key and SHA-256, with size and reference metadata.
- `units` hold extracted text, location (paragraph/slide/page), normalized-text hash, and optional vector embedding.
- `lineage_edges` describe revisions or generated artifacts and their source relationship.
- Sharing, near-duplicate links, lifecycle rules/events, and indexes support access, discovery, archive automation, and query performance.

Migrations are applied by `npm run db:migrate`. Database connection handling lives in `server/src/db/pool.ts`; transactions are used where related database changes need to commit together.

The additive migrations `004_ingestion_jobs.sql` through `010_usage_events.sql` add the durable ingestion queue, direct-upload sessions and counters, job metrics, full-text search, quiz attempts/reviews, annotations, and classroom usage events.

## Upload and ingestion pipeline

Classroom uploads support `classroom` visibility for everyone enrolled and `selected` visibility for specific students. Both faculty and students can choose recipients from the classroom student list. The server verifies each recipient is currently enrolled as a student, records recipients in `file_shares`, and the shared permission query limits student access to those recipients plus the uploader. This applies to both direct-to-object-storage and multipart uploads.

The browser first computes SHA-256 and calls the signed-upload init endpoint. A scoped exact match creates the file/version reference before any transfer; otherwise it receives a presigned PUT URL, transfers to a `staging/` key, and asks the API to verify size, stream-hash, and signature before final registration. Failed init or direct PUT falls back to the existing Multer multipart upload. Multipart uploads use the configured `MAX_UPLOAD_MB` memory limit. Supported document extensions are PDF, DOCX, and PPTX (generated quiz artifacts are also represented by the file model). Download and inline-preview URLs are signed and short-lived, while PDFs can also be streamed through the authenticated API.

`server/src/jobs/queue.ts` stores version work in PostgreSQL. Upload/version creation and enqueue share a database transaction. Workers claim with `FOR UPDATE SKIP LOCKED`, own a time-limited lease, heartbeat while processing, and apply bounded exponential retry backoff. `WORKER_MODE=embedded` runs a worker inside the API by default; `external` supports one or more standalone workers.

`server/src/jobs/ingest.ts` processes a version asynchronously and idempotently:

1. Load the object bytes from storage unless the upload buffer is already available.
2. Parse the document to ordered units and save each unit's locator, text, normalized text hash, and character count.
3. Generate embeddings for eligible units in batches of up to 20. Text hashes allow reuse of already stored embeddings for identical extracted units.
4. Compare unit hashes with the previous current version and record a revision edge/statistics.
5. Mark the version ready and point the file at it; on errors mark the version failed.
6. For searchable files, scan for candidate near-duplicates in scopes available to the uploader and record flagged links when configured similarity thresholds are met.

Parsing is text extraction, not full visual document rendering. DOCX extraction reads Word paragraphs, PPTX extraction follows presentation slide order and gathers slide text, and PDF extraction reads page text. Image-only PDF pages have no extracted text and are flagged; OCR is not present.

## Search and AI

`server/src/core/embed.ts` calls Gemini's embedding endpoint and expects 768-dimensional vectors. It batches requests and retries rate-limit responses. Vectors are stored in PostgreSQL `vector` columns and compared with cosine distance for semantic search. Name filtering can be used separately or alongside semantic search.

Migration `007_unit_full_text_search.sql` adds an English generated `tsvector` and GIN index. `server/src/core/retrieval.ts` runs access-filtered vector and keyword SQL queries and combines ranks with Reciprocal Rank Fusion. If embedding retrieval fails, it returns keyword results with `degraded=true`. The assistant uses these same retrieved excerpts and does not call Gemini when no relevant unit is found.

`server/src/routes/assistant.ts` performs retrieval from ready, current, searchable, non-retracted files, with access checks in SQL and optional file selection. The assistant prompt receives retrieved excerpts and source metadata, and the API returns answers with citations. The implementation includes a no-relevant-context path that can respond without asking the language model. Quiz generation requests JSON from Gemini and server code persists the structured quiz; presentation generation asks for structured content and uses `pptxgenjs` to build the PPTX bytes. Generated files are marked non-searchable to avoid retrieving model output as source material.

Generation uses `server/src/core/llm.ts`, which sends Gemini REST requests, requests JSON response mode for structured outputs, retries/falls back across configured model candidates for selected provider failures, and translates provider errors to API errors. Model names and the API key are environment-configured.

## Versioning, deduplication, and lifecycle

- **Exact deduplication:** SHA-256 of original file bytes; only byte-identical files can reuse a blob. Near-duplicate similarity never merges content.
- **Content comparison:** `diffArrays` compares ordered unit hashes and returns added/removed/same units for the version UI.
- **Near-duplicate detection:** embeddings identify similar units across authorized comparison scopes; a document-level fraction threshold controls whether to flag a possible match.
- **Lifecycle:** rules support age-based or watched-file-update archive actions, with dry-run state and event history. Lifecycle behavior archives files rather than deleting them.
- **Trash and garbage collection:** soft deletion retains file records and bytes for a retention period. The GC job rechecks actual references before removing eligible object bytes. A reconciliation job repairs blob reference counters.
- **Cost simulation:** the dashboard estimates naive, dedup-only, and dedup-plus-cold pricing from configurable rates. Cold eligibility uses reference state; the object store is not physically tiered.
- **Study flow:** quiz answer keys stay on the server until grading. The Leitner-style schedule stores missed questions and advances review boxes on correct answers.
- **Annotations and analytics:** annotations map between adjacent versions by unit hash. Classroom usage events are logged non-blockingly, and topic output is filtered by distinct student count before it reaches faculty.

The API starts periodic lifecycle, GC, and reference-reconciliation jobs unless `DISABLE_JOBS=true`. Equivalent one-off scripts are exposed by the package scripts.

## Configuration

See `.env.example` for server configuration, including `DATABASE_URL`, S3 endpoint/region/credentials/bucket, `GEMINI_API_KEY`, `JWT_SECRET`, `EMBEDDING_MODEL`, `LLM_MODEL`, `CLIENT_ORIGIN`, and limits/thresholds for upload, retention, and retrieval. The client can use `VITE_API_URL` (and the client template may define display settings). Never put real credentials in documentation or commit `.env`.

`npm run check:env` checks required settings and attempts database/vector, object-storage round-trip, Gemini embedding-dimension, and JWT configuration checks. `/api/health` gives a lighter live status check.

## Development and deployment commands

```bash
npm install
npm run check:env
npm run db:migrate
npm run dev
```

Useful scripts defined in `package.json`:

- `npm run dev` — run the `tsx watch` API and Vite client together.
- `npm run typecheck` — typecheck server and client.
- `npm run build` — compile the server and build the client.
- `npm run start` — start compiled server output.
- `npm run worker` / `npm run start:worker` — run a separate ingestion worker.
- `npm run setup:cors` — configure bucket CORS where supported.
- `npm run test:unit` / `npm test` — run offline tests and the database integration suite.
- `npm run db:migrate` / `npm run seed` — schema setup and seed.
- `npm run gc`, `npm run reconcile`, `npm run lifecycle` — run maintenance jobs directly.

For deployment, build the API and client with the appropriate environment configuration. The README describes a Render/Railway API and Vercel client setup; set the client API base URL and server `CLIENT_ORIGIN` to deployed origins.

## Verification status and technical gaps

`docs/TESTING.md` documents manual workflows and the available automated coverage. Unit tests pass; the database integration tests skip when the configured database is unreachable. External end-to-end behavior depends on live database, storage, and Gemini services. Compose configuration was validated, but the local Docker engine was unavailable for image builds. `DECISIONS.md` records these limitations and the remaining API-level integration coverage gaps.

