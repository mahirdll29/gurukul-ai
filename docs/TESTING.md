# Manual demo and verification

## Manual demo sequence

Prepare a five-version DOCX with a few paragraph edits per version, an approximately eight-slide PPTX, a text PDF, a byte-identical copy of that PDF, and a re-exported copy with different bytes. A text-less PDF is useful for checking the OCR warning behavior.

1. Register a new account from the sign-in page and confirm it lands in the personal file space.
2. Register a second account. Upload separate personal notes and confirm neither account can see the other's personal files.
3. To test course workflows, assign a registered user a course membership and faculty/student role in the database, then confirm the resulting access matches that role.
3. Upload the PDF and its identical copy as a student. Confirm exact dedup is reported and inspect the Dashboard storage totals.
4. Upload the re-exported PDF. Confirm it remains a separate file and inspect its similarity status.
5. Upload the five DOCX versions. Inspect the version history, compare two versions, and inspect the lineage view.
6. Search for a phrase in the source files and ask the assistant the same question. Check that cited sources link to accessible file locations.
7. Generate a quiz and a presentation from accessible files. Upload a newer version of a source and check whether the generated artifact reports staleness.
8. Move a file to Trash and restore it.

## Automated checks

- `npm run test:unit` runs the offline Vitest unit suite.
- `npm test` runs the unit suite and database integration suite.
- The integration suite creates a uniquely named temporary PostgreSQL schema, applies the project schema and migrations there, then drops the schema. It skips with an explicit message when `DATABASE_URL` is absent or unreachable.
- `npm run typecheck` checks the TypeScript server and client; `npm run build` compiles/builds both.
- `npm run check:env` requires reachable Neon Postgres/vector, S3-compatible storage, and Gemini embedding services for full external checks.

## Current environment result

On 24 November 2026, `npm run check:env` reported required variable names and JWT length as passing, while Neon database/vector, object-storage round trip, and Gemini embedding checks failed to connect. `npm test` passed the eight offline unit tests and skipped the three database integration tests because the configured database was unreachable. Docker Compose configuration validation passed, but the Docker Desktop engine was not running, so image builds were not verified. End-to-end acceptance checks therefore remain unverified in this environment.
