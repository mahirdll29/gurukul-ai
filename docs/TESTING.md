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

`npm run build` is the available typecheck and production build command. This checkout does not currently define the requested `test:step1` through `test:step5` scripts or an automated test suite. Run the build after changes; run `npm run check:env` only when the configured Neon, S3-compatible storage, and Gemini services are reachable.

## Current environment result

On 14 October 2026, `npm run check:env` reported the required variable names and JWT length as passing, while the Neon database/vector, object-storage round trip, and Gemini embedding checks failed to connect. End-to-end acceptance checks therefore remain unverified in this environment.
