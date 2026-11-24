# Build decisions

- Plan: keep the existing `/server/src` and `client/src` layout, complete the product in the requested order, and verify each stage with the available typecheck, build, and test commands.
- The supplied Change Notice is not present in the workspace; this build brief takes precedence over the available PRD.
- Phase 0 schema, seed, login, and environment checker already exist. They will be extended rather than rebuilt.
- The workspace has no Git metadata, so per-step commits cannot be created here.
- The npm registry is unreachable from this environment: `npm view zod version` did not return. Do not install new packages until each has been verified as instructed.
- Existing server and client directory layout differs from the PRD's illustrative layout only in that files.ts currently contains multiple route concerns. Keep the existing layout and split routes when practical.
- Client JWT storage remains `localStorage`, as required by the build instructions; this is retained from Phase 0.
- Gemini `gemini-embedding-2` does not accept `task_type`; use explicit text task prefixes as documented, with the same document prefix for all units and a query prefix for searches.
- No Google font stylesheet links will be used. Self-hosted Fontsource packages cannot be added until npm registry verification is available; the current visual step uses system fallbacks meanwhile.
- Known limitation from the PRD: GC can remove derived edges when it purges a source version; storage objects written before a later DB transaction failure can remain orphaned in v1.
- Step 0 replaced the Phase 0 welcome page with the Gurukul-AI sign-in screen and navigation shell. The Files and basic version-history views are connected to existing API routes; several remaining pages are still incomplete.
- Vite needs `resolve.preserveSymlinks=true` in this Windows workspace to avoid `EPERM` when resolving the client entry file.
- The app has no self-hosted Fontsource assets yet because those package names could not be verified through `npm view`; the visual CSS currently uses system font fallbacks.
- `helmet`, `express-rate-limit`, `zod`, `lucide-react`, fixture-generation packages, Vitest, and Supertest were not installed. Manual security headers are in place, but schema-based validation, package-backed login throttling, fixture generation, and the requested automated integration test suites remain outstanding.
- `npm run check:env` found no missing required variable names, but the configured database, storage, and Gemini endpoints failed their connectivity checks. External-service acceptance checks could not be run.
- `npm test` reports `Missing script: "test"`; this checkout did not have a test suite before this work.
- The available Neon Object Storage documentation endpoint could not be reached via the web documentation tool. The existing S3 client configuration follows the required `forcePathStyle: true` and AWS SDK S3 commands, but object-storage behavior still needs an actual round-trip check.
