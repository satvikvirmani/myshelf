# myShelf

Paste any website link. An AI reads it and files it into a category tree, with a name, a
description, tags and a confidence score.

    GEMINI_API_KEY=your-key npm start      # http://localhost:3000
    npm test                               # engine tests, no key or network needed

- **Deploying to Vercel:** see [DEPLOY.md](DEPLOY.md).
- **Routes:** `GET /` (filters: `c`, `q`, `tag`, `sort`), `GET /add` (form, works without JavaScript), `POST /add` (field `url`, plus `passcode` when `ADD_PASSCODE` is set), `GET /sites.json`.
- **Storage:** Redis (Upstash) when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set; otherwise `data/sites.json` locally.
- **Environment:** see `.env.example`. Required: `GEMINI_API_KEY`. Recommended on a public URL: `ADD_PASSCODE`.

Layout: `lib/app.js` (pages and routes), `lib/classify.js` (Gemini), `lib/taxonomy.js` (category tree), `lib/store.js` (storage), `server.js` (local), `api/index.js` (Vercel), `public/` (CSS and script), `tests/`.
