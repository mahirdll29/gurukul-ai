# PRD: Content-Aware University Cloud Storage with AI Assistant

Team: Mahir, Uday, Jeels. Version 1.0, 13 Oct 2026. Project name: Gurukul-AI.

## 0. Instructions for the AI coder

- Build only what is in this document. If something is unspecified, pick the simplest option and record it in `DECISIONS.md`. Do not add features.
- Build phase by phase (section 14). Each phase must pass its acceptance checks before the next starts.
- Before installing any npm package, confirm it exists with `npm view <pkg>`. Do not invent library APIs. For Gemini, Neon Object Storage, pgvector, React Flow and pptxgenjs, read the current official docs.
- Never hardcode secrets. Read them from env vars (section 5.3). Provide `.env.example` with empty values and keep `.env` in `.gitignore`.
- Priority tags: **P0** core, **P1** important, **P2** stretch. Do not build P2 unless asked.

## 1. Product summary

A cloud storage system for a university that parses documents (docx, pptx, pdf) instead of treating them as opaque blobs. Because it understands document structure it can: store identical files once, track and diff document versions, flag near-duplicate content, search by meaning, archive files by rules, and run a built-in AI assistant that answers questions, explains material, generates quizzes and builds presentations from the files a user is allowed to access.

Two spaces share one bucket, one database and one code path:

- **Personal space**: owned by a user, private.
- **Shared space**: owned by a course (org). Faculty write, enrolled students read.

### What 'savings' means in v1 (read carefully)

| Mechanism | Effect | Real bytes freed? |
| --- | --- | --- |
| Exact dedup (same SHA-256) | One stored blob, many pointers | Yes |
| Unit reuse across versions | Measured as 'repeated content' on the dashboard | No, measurement only |
| Near-duplicate detection (embeddings) | Flag and link | No, never merges |

Byte-level compaction of old versions (storing v2..vN as deltas) is **not built** in v1. Reason: rebuilding a Word or PowerPoint file byte-for-byte from paragraph deltas is unreliable because zip compression differs between writers. See section 16.

### Non-goals (v1)

Signing up, college SSO, sharing files between students, OCR, formats other than docx/pptx/pdf, mobile app, real-time collaboration, billing, physical storage tiering.

## 2. Roles and permissions

No global admin. Roles exist per course in `memberships`: `student` or `faculty`.

| Action | Owner of personal file | Faculty of org | Student of org | Anyone else |
| --- | --- | --- | --- | --- |
| Read personal file | Yes | n/a | n/a | No |
| Read org file | n/a | Yes | Yes | No |
| Upload, new version, archive, delete, retract in org | n/a | Yes | No | No |
| Upload, version, archive, delete in personal | Yes | n/a | n/a | No |
| Create quiz or deck from accessible files | Yes (saved to own personal space) | Yes (own personal space) | Yes (own personal space) | No |

The user id used in every permission check comes **only** from the verified JWT, never from request bodies or query strings.

## 3. Glossary

- **Blob**: immutable stored bytes in Neon Object Storage, identified by SHA-256 within a scope.
- **File**: a named entry owned by a user or an org. Has many versions.
- **Version**: one uploaded or generated blob belonging to a file. `files.current_version_id` points at the latest ready one.
- **Unit**: smallest parsed piece of a version: a docx paragraph, a pptx slide, a pdf page.
- **Lineage edge**: a record that version B came from version A. Kind `revision` (same file, next version) or `derived` (AI-generated file built from a source version).
- **Soft delete / tombstone**: `deleted_at` set, bytes kept.
- **Archive**: `archived_at` set. Hidden from default lists and AI retrieval, restorable, bytes kept. This is a logical state only.
- **Retraction**: a faculty marks a version wrong. Still viewable with a warning, excluded from AI retrieval.

## 4. Hard rules (invariants)

These override anything else. Add a test for each where practical.

1. **Permission filter happens in SQL before retrieval.** Rows a user cannot access must never be loaded into app memory or sent to the LLM.
2. **Only an identical SHA-256 may share a blob.** Embeddings and similarity never merge, replace or delete anything.
3. **Write bytes to Neon Object Storage first, commit DB rows last.** An orphan blob is harmless garbage; a row pointing at a missing blob is a bug.
4. **No `ON DELETE CASCADE` involving `blobs`, `files` or `users`.** Cascade is allowed only from `file_versions` to derived rows (`units`, `lineage_edges`).
5. **Blob bytes are removed only by the GC job**, only when the file has been soft-deleted longer than the retention period AND a fresh `COUNT(*)` of referencing versions is 0. The stored `ref_count` column is never trusted for this decision.
6. **The assistant answers only from retrieved excerpts.** If nothing relevant is retrieved, return the fixed message and do not call the LLM.
7. **The LLM never produces file bytes.** It returns JSON; server code builds pptx and quiz files.
8. **Generated files are not searchable** (`files.searchable = false`) so the assistant never answers from its own output.
9. **Lifecycle rules only archive. They never delete.**
10. **Cross-user matching never reveals another user's personal files.** Dedup and similarity checks run only against the uploader's own files and shared courses the uploader belongs to.
11. **Secrets are never logged or returned by the API.**

## 5. Tech stack and configuration

### 5.1 Stack (fixed)

| Layer | Choice |
| --- | --- |
| Server | Node.js, Express, TypeScript (dev runner `tsx`) |
| Database | PostgreSQL on **Neon** (pooled connection string) with the `vector` extension; driver `pg` |
| Object storage | Neon Object Storage (S3-compatible) via `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` |
| Auth | `bcryptjs` for hashing, `jsonwebtoken` for tokens |
| Uploads | `multer` (memory storage) |
| Parsing | `jszip`, `fast-xml-parser` (docx, pptx); `pdfjs-dist` legacy build for Node (pdf) |
| Diff | `diff` (`diffArrays`) over arrays of unit hashes |
| AI | Google Gemini API for embeddings and generation, called via REST `fetch` or the official Google GenAI JS SDK (check current docs); wrapped in `server/core/embed.ts` and `server/core/llm.ts` |
| File generation | `pptxgenjs` |
| Frontend | React, Vite, Tailwind CSS (follow its current Vite install guide), `react-router-dom`, React Flow (npm `@xyflow/react`; verify in docs). Plain `fetch` plus React state, no other UI library |
| Hosting | Server on Render or Railway, client on Vercel |

### 5.2 Repo layout

```
/server
  /src
    /parsers   docx.ts pptx.ts pdf.ts index.ts   (each returns Unit[])
    /core      hash.ts diff.ts embed.ts llm.ts storage.ts permissions.ts
    /routes    auth.ts files.ts search.ts assistant.ts stats.ts trash.ts
    /jobs      ingest.ts gc.ts lifecycle.ts reconcile.ts
    /db        schema.sql pool.ts seed.ts
/client  (Vite React app)
DECISIONS.md  README.md  .env.example
```

### 5.3 Environment variables

Server: `DATABASE_URL`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `GEMINI_API_KEY`, `JWT_SECRET`, `EMBEDDING_MODEL`, `LLM_MODEL`, `EMBEDDING_DIM` (768), `CLIENT_ORIGIN`, `PORT`.

Tunables with defaults (all tunable, none are validated truths): `MAX_UPLOAD_MB=20`, `TRASH_RETENTION_DAYS=30`, `LIFECYCLE_DRY_RUN_DAYS=7`, `RETRIEVAL_TOP_K=8`, `RETRIEVAL_MIN_SCORE=0.5`, `VERSION_SUGGEST_JACCARD=0.5`, `NEAR_DUP_UNIT_SIM=0.9`, `NEAR_DUP_DOC_FRAC=0.7`, `MAX_CONTEXT_CHARS=60000`.

Client: `VITE_API_URL`, `VITE_APP_NAME`, configured in `client/.env.example`. `npm run check:env` reports PASS/FAIL for required variables, Neon database and `vector`, an object-storage round trip, Gemini embedding dimensions, and JWT secret length. It never prints variable values.

Model names are env vars on purpose. The embedding model must support a configurable 768-dimension output. At startup, embed the text 'test' and exit with a clear error if the returned length is not 768.

## 6. Data model (PostgreSQL)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL, name text NOT NULL,
  password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE memberships (
  user_id uuid NOT NULL REFERENCES users(id), org_id uuid NOT NULL REFERENCES orgs(id),
  role text NOT NULL CHECK (role IN ('student','faculty')),
  PRIMARY KEY (user_id, org_id));

CREATE TABLE blobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL CHECK (scope_type IN ('user','org')),
  scope_id uuid NOT NULL, sha256 text NOT NULL, size_bytes bigint NOT NULL,
  storage_key text UNIQUE NOT NULL, ref_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, sha256));

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL CHECK (owner_type IN ('user','org')),
  owner_id uuid NOT NULL, name text NOT NULL,
  format text NOT NULL CHECK (format IN ('docx','pptx','pdf','quiz')),
  kind text NOT NULL CHECK (kind IN ('upload','generated')),
  searchable boolean NOT NULL DEFAULT true,
  current_version_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz, deleted_at timestamptz);

CREATE TABLE file_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES files(id),
  version_no int NOT NULL, blob_id uuid NOT NULL REFERENCES blobs(id),
  original_name text NOT NULL, size_bytes bigint NOT NULL, sha256 text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','ready','failed')),
  error text, unit_count int NOT NULL DEFAULT 0,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  retracted_at timestamptz, retract_reason text,
  UNIQUE (file_id, version_no));
ALTER TABLE files ADD FOREIGN KEY (current_version_id) REFERENCES file_versions(id);

CREATE TABLE units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
  idx int NOT NULL, locator text NOT NULL, text text NOT NULL,
  text_hash text NOT NULL, char_count int NOT NULL,
  embedding vector(768),
  UNIQUE (version_id, idx));
CREATE INDEX units_hash_idx ON units (text_hash);

CREATE TABLE lineage_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_version_id uuid NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
  to_version_id uuid NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('revision','derived')),
  stats jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_version_id, to_version_id, kind));

CREATE TABLE near_duplicate_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  version_id uuid NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
  matched_version_id uuid NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
  match_fraction real NOT NULL,
  status text NOT NULL DEFAULT 'flagged' CHECK (status IN ('flagged','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE lifecycle_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES files(id), created_by uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('AFTER_DAYS','WHEN_FILE_UPDATED')),
  params jsonb NOT NULL,
  state text NOT NULL DEFAULT 'dry_run' CHECK (state IN ('dry_run','active','fired','disabled')),
  activates_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES files(id), rule_id uuid REFERENCES lifecycle_rules(id),
  action text NOT NULL CHECK (action IN ('archive','would_archive','unarchive')),
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
```

Notes: `blobs.ref_count` is a convenience counter updated in the same transaction as the version insert. The real count is always `SELECT COUNT(*) FROM file_versions WHERE blob_id = ...`. Do not create a vector index in v1; exact scan is correct at demo scale and avoids filtered-index recall issues.

## 7. Parsing spec (outputs `Unit[]`)

Unit = `{ idx, locator, text, text_hash, char_count }`.

**Normalization** (applied to every unit): Unicode NFC, collapse all whitespace runs to one space, trim. `text_hash` = SHA-256 hex of the normalized text. Units that are empty after normalization are dropped.

| Format | Unit | Locator | Rules |
| --- | --- | --- | --- |
| docx | Paragraph (`w:p`) from `word/document.xml`, in document order, including paragraphs inside tables | `Para {n}` (n = 1-based count of non-empty paragraphs) | Text = concatenation of `w:t` runs; `w:tab` becomes a space. Headers, footers, footnotes, comments ignored |
| pptx | Slide | `Slide {n}` (n = position in slide order) | Slide order comes from `ppt/presentation.xml` slide id list resolved through `ppt/_rels/presentation.xml.rels`, not from file names. Text = all `a:t` runs in the slide, paragraphs separated by a space. Notes ignored. Slides with no text produce no unit |
| pdf | Page | `Page {n}` | Text from `pdfjs-dist`. Pages with no text produce no unit. Scanned PDFs finish as `ready` with 0 units and a warning 'No extractable text (OCR not supported)' |

Validation: extension must be `.docx`, `.pptx` or `.pdf`; magic bytes must match (`PK` for docx/pptx, `%PDF` for pdf); size at most `MAX_UPLOAD_MB`. Password-protected or corrupt files end as `failed` with a readable `error`.

## 8. Ingestion pipeline

`POST /api/files` validates, hashes and stores synchronously, then processes asynchronously in-process (no queue).

1. Authorize the target scope (personal, or an org where the user is faculty).
2. Compute SHA-256 of the buffer.
3. **Blob resolution (exact dedup):**
   - Org upload: look for a blob with `(org, orgId, sha256)`.
   - Personal upload: first look in each org the user belongs to for `(org, orgId, sha256)`; if found, reuse it and set `dedup.matchedScope = 'shared'`. Otherwise look for `(user, userId, sha256)`. Never look in other users' scopes.
   - If none exists: `PUT` to Neon Object Storage (key `{scope_type}/{scope_id}/{sha256}`), then insert the blob row.
4. In one DB transaction: insert `files` (or reuse `targetFileId`), insert `file_versions` with status `processing`, increment `blobs.ref_count`.
5. Respond immediately with `{ fileId, versionId, status, dedup }`.
6. Background: parse, insert units, (P1) embed, set status `ready` and `unit_count`.
7. When ready: set `files.current_version_id` to this version. For a new version of an existing file also create a `revision` lineage edge from the previous current version with `stats = {added, removed, unchanged}` from the unit-hash diff. Failed versions never become current.
8. (P1) Run version-suggestion and near-duplicate scans (section 9, F5).

On server start, any version stuck in `processing` for more than 10 minutes is set to `failed` with error 'Interrupted'. `POST /api/files/:id/versions/:vid/reprocess` re-runs step 6 onward.

Unit embedding reuse: before calling Gemini, reuse an existing embedding for the same `text_hash` from any row. This is internal and never exposed.

## 9. Features

### F1. Auth (P0)

Seeded users only. `POST /api/auth/login` with email and password returns a JWT (24h) and the user with their memberships. `GET /api/auth/me`. Token sent as `Authorization: Bearer`. Passwords hashed with bcrypt. Wrong credentials return 401 with a generic message.

### F2. Upload, list, download (P0)

- Upload page supports drag and drop and a scope selector (My files, or a course where the user is faculty) and an optional 'upload as new version of' file picker.
- Lists show name, format, size, status badge (processing, ready, failed), version count, and dedup badge when exact-matched against shared content.
- Download returns a presigned Neon Object Storage URL valid 60 seconds, issued only after the permission check.
- Names need not be unique.

### F3. Exact dedup (P0)

As in section 8 step 3. The upload response and UI state plainly when a file matched an existing course file ('Stored as a pointer, no new storage used'). The response names only the course, never another user's file.

### F4. Versions, structural diff, lineage (P0)

- Version history page per file: timeline of versions with date, uploader, size, unit count, and added/removed/unchanged stats from the revision edge.
- Diff: `GET /api/files/:id/diff?from=&to=`; both versions must belong to the file. Uses `diffArrays` on `text_hash` arrays, returns ordered ops `{type: 'same'|'added'|'removed', units: [{locator, text}]}`. UI shows added in green, removed in red, collapsed runs of unchanged units.
- 'Make current' on any ready, non-retracted version sets `current_version_id` (owner or faculty only). This is the restore action.
- Lineage graph (React Flow): nodes are versions, edges are `revision` and `derived`. Generated files show as nodes linked to their source versions.

### F5. Near-duplicate flags and version suggestions (P1)

Runs after a version becomes ready, only if it has at least 3 embedded units.

- **Near-duplicate:** for each embedded unit, find nearest units (cosine) among current versions of other files the uploader can access (own files plus courses they belong to), excluding the same file and excluding files sharing the same blob. A candidate file counts a unit as matched when similarity is at least `NEAR_DUP_UNIT_SIM`. If a candidate file matches at least `NEAR_DUP_DOC_FRAC` of the new version's embedded units, insert a `near_duplicate_links` row visible only to the uploader. UI banner: 'Looks similar to \<file>. Nothing was merged.' with Open and Dismiss.
- **Version suggestion:** compare `text_hash` sets (Jaccard) against current versions of the uploader's own files of the same format. If Jaccard is at least `VERSION_SUGGEST_JACCARD`, return it in the file detail as a suggestion. `POST /api/files/:id/merge-into/:targetId` moves the single-version source file into the target as the next version. Allowed only when both files have the same owner and format, the source has exactly one version, and permission rules in section 2 hold. The emptied source file entry is soft-deleted.

### F6. Semantic search (P1)

`GET /api/search?q=&fileIds=` embeds the query, runs the permission-filtered query in section 10.1, returns the top units grouped by file with score, locator and snippet. Search page also supports a plain filename filter.

### F7. Deletion safety (P0)

- `DELETE /api/files/:id` soft-deletes (sets `deleted_at`). Hidden from lists, search and AI. Trash page lists deleted files with 'Restore' for `TRASH_RETENTION_DAYS`.
- Deleting an org file hides it for all members but does not touch students' own files that reference the same blob.
- **Retraction (faculty):** `POST /api/files/:id/versions/:vid/retract` with a reason. The version stays downloadable with a warning banner, is excluded from AI retrieval and from new quiz or deck generation, and any derived artifact built from it shows as stale ('source retracted').
- **GC job** (`npm run gc`, also an in-process daily timer): for files with `deleted_at` older than retention, delete their versions (units and edges cascade), then for each affected blob run a fresh `COUNT(*)` of referencing versions; only if 0, delete the Neon Object Storage object and the blob row. Log every action.
- **Reconcile job** (`npm run reconcile`): compare `ref_count` to the real count, log mismatches, correct the column. Never deletes bytes.

### F8. Lifecycle and archive (P1)

- **Inferred:** a version that is not current is shown as 'superseded' in history (derived at read time, no job). Superseded versions are excluded from search and AI retrieval.
- **Manual:** `POST /api/files/:id/archive` and `/unarchive`.
- **Declared rules:** per file, two types only: `AFTER_DAYS` with `{days: n}` (age since the file was created) and `WHEN_FILE_UPDATED` with `{watch_file_id}` (fires when the watched file gets a new current version after the rule was created). Action is always archive. A new rule starts in `dry_run` until `activates_at = created_at + LIFECYCLE_DRY_RUN_DAYS`; in dry run it only writes `would_archive` events. Set the variable to 0 for demos.
- `npm run lifecycle` and an hourly in-process timer evaluate rules. Every event is logged with a reason and shown on the file page. Archiving is reversible with one click.

### F9. Generated files and staleness (P1)

Quizzes and decks are saved as files in the creator's personal space (`kind='generated'`, `searchable=false`) with `derived` lineage edges from each source version used. A generated file is **stale** when, at read time, any source file's `current_version_id` differs from the edge's `from_version_id`, or the source version is retracted, or the source file is deleted. Staleness is computed on read and shown as a badge with the reason. No job needed.

### F10. Savings dashboard (P0)

`GET /api/stats` for the caller's visible scope (own files plus enrolled courses; non-deleted files):

- `logicalBytes` = sum of `size_bytes` over all visible versions.
- `storedBytes` = sum of `size_bytes` over distinct `blob_id` referenced by those versions.
- `exactDedupSavedBytes` = logical minus stored.
- `unitsTotal` = count of units over visible versions; `unitsDistinct` = count of distinct `text_hash` among them; 'repeated content' = 1 minus distinct/total, labeled as a measurement, not freed space.
- Counts of files, versions, flagged near-duplicates. Show these in cards with a one-line explanation each.

### P2 (do not build unless asked)

Annotations as private copy-on-write deltas on shared files; graduation 'materialize my referenced files' pass; AI-proposed lifecycle rules; nightly metadata export; docx generation; notebook (.ipynb) support; byte-level compaction of old versions.

## 10. AI assistant spec (P1)

### 10.1 Retrieval (the only retrieval query)

```sql
SELECT u.id AS unit_id, u.idx, u.locator, u.text, fv.id AS version_id,
       f.id AS file_id, f.name AS file_name,
       1 - (u.embedding <=> $1) AS score
FROM units u
JOIN file_versions fv ON fv.id = u.version_id
JOIN files f ON f.id = fv.file_id AND f.current_version_id = fv.id
WHERE u.embedding IS NOT NULL
  AND fv.status = 'ready' AND fv.retracted_at IS NULL
  AND f.deleted_at IS NULL AND f.archived_at IS NULL AND f.searchable = true
  AND ( (f.owner_type = 'user' AND f.owner_id = $2)
     OR (f.owner_type = 'org' AND f.owner_id IN
         (SELECT org_id FROM memberships WHERE user_id = $2)) )
  AND ($3::uuid[] IS NULL OR f.id = ANY($3))
ORDER BY u.embedding <=> $1
LIMIT $4;
```

`$1` is the query embedding, `$2` is the user id from the JWT, `$3` is an optional file id scope (every id must also pass the permission check), `$4` is `RETRIEVAL_TOP_K`. Drop results below `RETRIEVAL_MIN_SCORE`.

### 10.2 Ask and explain

`POST /api/assistant/ask` body `{ question, mode: 'answer'|'explain', level?: 'beginner'|'standard'|'advanced', fileIds?, locator?, history? }`.

- Context = retrieved units plus the previous and next unit (same version) of each, de-duplicated, capped at 12000 characters. For `explain` with a single `fileId` and a `locator`, skip vector search and use that unit plus its neighbors.
- `history` is the last 6 chat messages sent by the client for prompt context only. It is not stored. Retrieval uses the latest question only.
- If no unit passes the threshold, return `{ answer: 'I could not find this in the files you have access to.', sources: [] }` without calling the LLM.
- Excerpts are numbered S1, S2, and so on. System prompt for `answer`: use ONLY the excerpts, cite every claim as \[S#\], and reply exactly `NOT_IN_FILES` if they do not contain the answer. For `explain`: explain at the requested level using the excerpts; any sentence that adds general background must start with 'Background (not from your files):'. This is a prompt instruction and is not machine-verified.
- Server validates citations: remove any \[S#\] that does not exist. `NOT_IN_FILES` maps to the fixed message above. Temperature 0.3.
- Response: `{ answer, sources: [{ n, fileId, fileName, versionId, locator, snippet }] }`. Citations in the UI link to the file at that locator.

### 10.3 Quiz

`POST /api/assistant/quiz` body `{ fileIds, numQuestions (5 to 20, default 10), difficulty: 'easy'|'medium'|'hard' }`.

- Source text = units of the current, non-retracted versions of the chosen accessible files, capped at `MAX_CONTEXT_CHARS` by sampling units evenly by index.
- LLM returns JSON only: `{ title, questions: [{ question, options: [4 strings], correctIndex: 0-3, explanation, locator }] }`. Server validates: exactly 4 distinct options, integer `correctIndex` 0 to 3, non-empty explanation. If invalid, retry once, then return an error.
- Saved as a generated file (`format='quiz'`, blob is the JSON) with derived edges. Quiz UI: one question at a time, select an answer, show explanation, final score, option to retake.

### 10.4 Presentation

`POST /api/assistant/presentation` body `{ fileIds, topic?, slideCount (5 to 15, default 8) }`.

- LLM returns JSON only: `{ title, slides: [{ title, bullets: [3 to 5 strings, max 20 words each], notes? }] }`, based only on the supplied unit text.
- Server builds the .pptx with `pptxgenjs`: 16:9, a title slide, the content slides, and a final 'Sources' slide listing source file names. One plain theme (white background, one accent color). Speaker notes from `notes` if present.
- Saved as a generated file (`format='pptx'`) with derived edges and a normal download.

## 11. API summary

All under `/api`, JSON, errors as `{ error: { code, message } }` with correct HTTP codes (400, 401, 403, 404, 413, 422, 500).

| Method and path | Purpose | Phase |
| --- | --- | --- |
| POST `/auth/login`, GET `/auth/me` | Auth | 0 |
| POST `/files` (multipart: `file`, `scope`, optional `targetFileId`) | Upload | 1 |
| GET `/files?scope=personal\|org:<id>&includeArchived=` | List | 1 |
| GET `/files/:id` | Detail, versions, suggestions, lifecycle, staleness | 1 |
| GET `/files/:id/versions/:vid/download` | Presigned URL | 1 |
| POST `/files/:id/versions/:vid/reprocess` | Retry processing | 1 |
| GET `/files/:id/diff?from=&to=` | Structural diff | 2 |
| POST `/files/:id/versions/:vid/make-current` | Restore a version | 2 |
| GET `/files/:id/lineage` | Graph nodes and edges | 2 |
| DELETE `/files/:id`, POST `/files/:id/restore`, GET `/trash` | Soft delete | 2 |
| POST `/files/:id/versions/:vid/retract` | Faculty retraction | 2 |
| GET `/stats` | Dashboard numbers | 2 |
| GET `/search` | Semantic search | 3 |
| POST `/files/:id/merge-into/:targetId`, POST `/near-duplicates/:id/dismiss` | F5 actions | 3 |
| POST `/files/:id/archive`, `/unarchive`, POST/GET `/files/:id/rules` | Lifecycle | 4 |
| POST `/assistant/ask`, `/assistant/quiz`, `/assistant/presentation`, GET `/files/:id/quiz` | AI | 5 |

## 12. Frontend pages

Login; Files (tabs: My files, one tab per course); File detail (version timeline, diff viewer, lineage graph, near-duplicate banner, lifecycle rules and event log, stale badge); Search; Assistant (chat with a file-scope selector, clickable citations, Generate Quiz and Generate Presentation buttons, quiz taker); Dashboard; Trash. Poll `GET /files/:id` every 2 seconds while status is `processing`. Show a clear error state and a Retry button for `failed`.

## 13. Seed data and demo script

`npm run seed` creates the CS301 and CS302 course spaces. Users register through the application; course membership and roles are assigned separately by an administrator.
- Courses `CS301 Database Systems` and `CS302 Operating Systems`.

**Test files to prepare:** one docx saved as 4 to 5 versions with a few paragraphs edited each time; one real lecture pptx; one lecture pdf; the same pdf copied under a different filename (identical bytes); the same pdf re-exported or re-saved so bytes differ.

**Demo, in order:** (1) prof uploads slides to CS301, both students see them, only student1 sees CS302. (2) each student uploads private notes, neither sees the other's. (3) student uploads the renamed identical pdf: stored as a pointer, dashboard shows exact dedup savings. (4) student uploads the re-exported pdf: flagged as similar, not merged. (5) upload docx v2 to v5, show timeline, diff and lineage graph. (6) search 'grading policy' and ask the assistant the same, with citations. (7) generate a quiz and a deck, then prof uploads a new version of the slides and the deck shows as stale. (8) delete a file, restore it from Trash.

## 14. Build phases and acceptance checks

**Phase 0: scaffold.** Repo, schema applied to Neon, seed, login works, `.env.example`, and `npm run check:env`. Check: seeded users log in; wrong password returns 401; environment checks cover database/vector, Neon Object Storage, Gemini and JWT_SECRET. Stop after Phase 0 until approved to continue.

**Phase 1: upload and parse.** Neon Object Storage, validation, exact dedup, docx/pptx/pdf parsers, units, list and download. Check: identical bytes uploaded twice produce one blob and `ref_count = 2`; unit counts match the source documents; corrupt file ends `failed`.

**Phase 2: versions, deletion, stats.** Revision edges, diff, make-current, lineage graph, soft delete, trash, retraction, GC and reconcile, dashboard. Check: diff of two docx versions shows exactly the paragraphs edited; deleting an org file does not break a student's pointer to the same blob; GC never deletes a blob with a referencing version.

**Phase 3: embeddings, search, near-duplicates.** Embedding with batching of at most 20 texts per request, sequential, retry with exponential backoff on HTTP 429 up to 5 attempts. Check: query returns only permitted rows (test with student2 searching for CS302-only content: zero results); re-exported pdf is flagged but not merged.

**Phase 4: lifecycle.** Rules, dry run, archive events. Check: with dry run on, a rule logs `would_archive` and archives nothing.

**Phase 5: assistant.** Ask, explain, quiz, presentation, staleness. Check: a question not covered by any file returns the fixed message; a generated pptx opens in PowerPoint; uploading a new version of the source marks the deck stale.

## 15. Out of scope (do not build)

Everything listed under Non-goals and P2. No real-time sync, no server-side OCR, no cross-user dedup of personal files, no physical storage tiering, no LLM-driven deletion of any kind.

## 16. Known limits, assumptions, items to verify

1. **Version compaction is not byte-level in v1.** Storing old versions as deltas would save real space, but exact reconstruction of docx and pptx files is unreliable in Node. Decision for the team: keep v1 as specified, or later add an opt-in 'compact old versions' feature that keeps formatting loss visible to the user. Until then, the project claims exact dedup savings plus measured content repetition, not delta-compressed storage.
2. Gemini model names, output-dimension support and free-tier rate limits change. Set them in env and check current docs.
3. All thresholds in section 5.3 are starting guesses. Tune them on the real test files.
4. Neon Object Storage has a 5 GB free-plan limit, sufficient for the demo. Neon's free database suspends when idle, so the first request after a pause is slower. Render free services may sleep.
5. `pdfjs-dist` in Node needs its legacy build; confirm the import path in its docs.
6. Scanned PDFs have no searchable text in v1.
7. Project name is undecided; use `APP_NAME`.
