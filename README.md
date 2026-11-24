# Gurukul-AI

University document storage with structured parsing, exact deduplication, version history, semantic retrieval, and study tools.

## Requirements

- Node.js 20.19+ or 22.12+
- Neon Postgres with the `vector` extension
- Neon Object Storage bucket and S3 credentials
- Gemini API access for the configured embedding and generation models

## Setup

1. Copy `.env.example` to `.env` and configure the listed server variables. Do not commit `.env`.
2. Copy `client/.env.example` to `client/.env` and set the client API URL as needed.
3. Run `npm install`.
4. Run `npm run check:env` to check database, object storage, Gemini embedding, and JWT configuration.
5. Run `npm run db:migrate`.
6. Run `npm run dev` and open the Vite URL.

Choose the Student or Professor portal on the sign-in page, then use **Create a student account** or **Create a professor account** if you have not registered yet. Professors create classrooms from the Professor home page and share each generated join code with their students. Students enter that code from the Student home page. Open a classroom to upload or view its PDF, DOCX, or PPTX materials. PDFs open in the app; slide decks and documents display their extracted sections in the app. The integrated AI assistant can cite and explain any ready, indexed file the signed-in user is allowed to access, including classroom files, without a second upload. Student uploads can be shared with the whole class or selected classmates.

After pulling schema changes, run `npm run db:migrate` before starting the server. File uploads and AI indexing need a reachable Postgres database, configured object storage, and working Gemini embedding/generation models; check `npm run check:env` and `/api/health` if sign-in, uploads, or AI responses fail. Files are retained in the configured object storage and accessed by the app through authorized previews and retrieval.

The local web client uses `http://localhost:3000/api` by default. For a deployment, build the client with `VITE_API_URL` set to the API base URL ending in `/api`, and set the API's `CLIENT_ORIGIN` to the frontend origin. Multiple origins can be comma-separated. Check `https://your-api-host/api/health` to see whether the API, database, storage configuration, and AI configuration are available.

## Scripts

- `npm run build` builds the TypeScript server and Vite client.
- `npm run start` starts the compiled server.
- `npm run check:env` checks required external services without printing credential values.
- `npm run gc`, `npm run reconcile`, and `npm run lifecycle` run maintenance jobs.

## Deploy

### Render or Railway

Build with `npm install && npm run build`; start with `npm run start`. Configure the server environment variable names from `.env.example`, set `CLIENT_ORIGIN` to the deployed client origin, and configure the database, object-storage, and Gemini credentials in the hosting platform's secret settings. Set the client build variable `VITE_API_URL` to the deployed API base URL ending in `/api`.

### Vercel

Deploy the `client` directory as a Vite app. Set `VITE_API_URL` to the deployed API base URL. The `client/vercel.json` rewrite serves the SPA routes through `index.html`.

## Verification notes

See [docs/TESTING.md](docs/TESTING.md) for the registration workflow and current verification limitations.
