# Skill Shelf

A single-page collection of GitHub repositories. Zero dependencies (Node 18+).

    npm start            # http://localhost:3000

- **Deploying to Vercel:** see [DEPLOY.md](DEPLOY.md).
- Routes: `GET /`, `GET /add` (form, no-JS fallback), `POST /add` (field `url`), `GET /?sort=az`.
- Storage: Redis (Upstash) when `KV_REST_API_URL` / `KV_REST_API_TOKEN` are set; otherwise `data/links.json` locally.
- Env: `PORT`, `DATA_FILE`, `GITHUB_API` (testing), `GITHUB_TOKEN` (optional, raises GitHub rate limit).

Layout: `lib/app.js` (handler), `lib/store.js` (storage), `server.js` (local), `api/index.js` (Vercel), `public/` (CSS, JS).
