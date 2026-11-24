# Gurukul-AI: Project Overview

## What we are building

Gurukul-AI is a university-focused document library that combines course classrooms, personal file storage, document-aware processing, and an AI study assistant. Instead of treating each upload as an opaque file, the system extracts the text into useful units (paragraphs, slides, or pages). Those units support semantic search, cited question answering, version comparison, and similarity checks.

The product serves two account portals:

- **Student:** join classrooms using a professor's join code, read course materials, upload personal or class-shared materials, search accessible documents, and use the AI study tools.
- **Professor:** create classrooms, share course materials, and manage the classroom library and its versions.

Each user also has a private personal space. In a classroom, faculty can write course files; students can read files available to the class and, for student uploads, share with the whole class or selected classmates. Access is enforced by the server using the signed-in user's identity and classroom membership.

## What the application can do

### Files and classroom workflow

- Register and sign in as a student or professor.
- Create a classroom and share its join code, or join a classroom with a code.
- Upload PDF, DOCX, and PPTX files to personal or classroom spaces.
- Preview PDFs in the app and display extracted sections for DOCX/PPTX files.
- Retain multiple versions, view version history, compare extracted content, and inspect file lineage.
- Archive and restore files; move files to Trash and restore them during the retention window.
- Share student-uploaded classroom files with the class or chosen classmates.

### Content intelligence

- Extract text at a document-appropriate level: DOCX paragraphs, PPTX slides, and PDF pages.
- Detect byte-identical content with SHA-256 and reuse a stored blob within its storage scope.
- Embed extracted units and run semantic search over files the user can access.
- Flag likely near-duplicate documents based on embedding similarity. Similarity is only a warning/link; it does not merge or remove content.
- Ask the assistant questions about selected or otherwise accessible indexed files. Responses include source references and use retrieved excerpts as context.
- Generate quizzes and presentations from accessible files. Quiz and presentation output is built by server-side code and stored as generated, non-searchable files.
- Apply lifecycle rules that can archive a file after a period or after a watched file changes. Rules can have an initial dry-run period.
- View storage/content statistics, including exact-dedup savings and repeated extracted content.

## How content moves through the system

1. The signed-in user uploads a supported file to the API.
2. The API checks access and file constraints, hashes the bytes, and checks for a matching blob within the applicable scope.
3. New bytes are written to S3-compatible object storage. The database then records the file/version/blob relationship.
4. Background ingestion downloads and parses the file, stores extracted units, creates or reuses embeddings, records version lineage, and marks the version ready (or failed with an error).
5. Search and assistant requests first restrict candidate material to files the user is authorized to access. Semantic ranking selects relevant units; the assistant receives those excerpts and can cite their source files and locations.

## Product principles and boundaries

- Permission checks are part of the data query path; private material must not enter another user's retrieval context.
- Exact deduplication is based on identical SHA-256 bytes. Similar text is never enough to merge files.
- Archive and soft-delete are logical states. The configured garbage-collection job is responsible for removing eligible object bytes after the trash retention period.
- A PDF with no extractable text receives an OCR-not-supported warning. OCR is not currently implemented.
- The product currently targets desktop web workflows and PDF, DOCX, and PPTX content.

## Future features that could elevate the project

These are opportunities for later iterations, not claims about current implementation:

1. **OCR and scanned-document support** — make image-only lecture notes searchable and usable by the assistant.
2. **University identity and roster integration** — add campus SSO and automatic course enrollment from a learning-management system.
3. **Richer study workflows** — let students save study sets, track quiz attempts, and get explanations or revision plans tied to cited course material.
4. **Instructor analytics** — show aggregate engagement and identify course topics that students search or ask about most, with privacy-conscious reporting.
5. **Collaborative annotation** — add comments, highlights, and instructor annotations anchored to a page, slide, or paragraph.
6. **Broader format and accessibility support** — support spreadsheets, accessible exports, captions/transcripts, and mobile-friendly views.
7. **Operational hardening** — add automated integration tests, monitoring for ingestion failures and AI usage, and production-grade rate limits and request validation.

The PRD also lists real-time collaboration, billing, and physical storage tiering as outside the initial product scope; these would require separate product and infrastructure decisions.

## Repository map

- `client/` — React/Vite browser application.
- `server/` — Express API, database schema/migrations, parsing, AI integrations, storage, and maintenance jobs.
- `docs/TESTING.md` — manual demonstration workflow and verification limitations.
- `README.md` — setup, scripts, and deployment notes.
- `DECISIONS.md` — implementation choices and known gaps.
- `PRD Content-Aware University Cloud Storage with AI Assistant.md` — product requirements and original architecture direction.

## Current maturity

The repository contains an end-to-end application implementation and production build artifacts, but external-service acceptance depends on configured Neon Postgres, S3-compatible object storage, and Gemini credentials. The repository's testing notes say a formal automated test suite is not currently defined; the manual demo checklist describes workflows that should be checked in a fully configured environment. Some product ideas in the PRD are not part of the current implementation and are listed above as future scope.

