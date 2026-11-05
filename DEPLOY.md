# Deploying Skill Shelf to Vercel

About 10 minutes. You need a GitHub account and a Vercel account (the free Hobby plan is enough).

## What changed for Vercel, and why

Vercel runs your code as short-lived serverless functions. They cannot save files, so the local
`data/links.json` approach would lose every link you add. The project now works like this:

| Piece | Where it runs | Notes |
|---|---|---|
| `lib/app.js` | everywhere | The page, the add-link form and all routes. One handler shared by both entry points below. |
| `server.js` | your computer | `npm start` runs the handler as a normal server on port 3000. |
| `api/index.js` | Vercel | Runs the same handler as a Vercel function. |
| `vercel.json` | Vercel | Sends every URL (`/`, `/add`, `/?sort=az`) to that one function, and bundles `public/`. |
| `lib/store.js` | everywhere | Saves links in **Redis** when it is configured, otherwise in `data/links.json` (local only). |

Routes, the form field (`url`), redirects and the page itself are unchanged.

If Redis is not configured on Vercel, the site still loads, but **Add a link** shows
"Storage is not set up yet" instead of silently losing your link. Step 3 fixes that.

---

## Step 1: Put the project on GitHub

From the project folder:

```bash
git init
git add .
git commit -m "Skill Shelf"
git branch -M main
```

Create an empty repository on GitHub (no README), then:

```bash
git remote add origin https://github.com/<you>/skill-shelf.git
git push -u origin main
```

`.gitignore` already keeps `.env` files and `.vercel/` out of the repository.

## Step 2: Import it into Vercel

1. Go to <https://vercel.com/new> and choose **Import** next to your `skill-shelf` repository.
2. Leave **Framework Preset** as **Other**.
3. Leave **Build Command**, **Output Directory** and **Install Command** empty. There is no build step.
4. Choose **Deploy**.

The first deployment will work, but you cannot save links until the next step.

## Step 3: Add storage (required)

1. In your Vercel project, open the **Storage** tab.
2. Under **Marketplace Database Providers**, choose **Upstash** and then **Redis** (the free plan is enough).
3. Pick a name and the region nearest you, then create it.
4. When asked, connect it to the `skill-shelf` project for **all environments** (Production, Preview, Development).

Vercel adds these environment variables to the project for you:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

Check them under **Settings → Environment Variables**. The app also accepts
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` if you created the database at upstash.com
directly. In that case, copy the two values from the database's **REST API** section and add them yourself.

**Environment variables only apply to new deployments**, so redeploy now:
**Deployments → ⋯ on the latest one → Redeploy**.

## Step 4 (optional, recommended): raise the GitHub rate limit

Without a token, GitHub allows 60 lookups per hour per server address, and Vercel functions share
addresses, so you may hit this sooner than expected. To raise it to 5,000 per hour:

1. At <https://github.com/settings/tokens>, create a **fine-grained token** with **no extra permissions** (public repositories only).
2. In Vercel, add it as an environment variable named `GITHUB_TOKEN`, then redeploy.

## Step 5: Check that it works

Open your `*.vercel.app` address and go through this list:

1. The page loads with **The shelf is empty**.
2. Choose **Add a link**, enter `github.com/<owner>/<repo>` for a real public repository, and submit.
3. You see **Added owner/repo to the shelf**, and the name and description appear.
4. Reload the page, then redeploy once. The repository is still there. (This proves it is stored in Redis, not on disk.)
5. Add a second repository and try **Order → Name, A to Z**.

---

## Deploying from the command line instead

```bash
npm i -g vercel
vercel login
vercel link          # answer the prompts; framework "Other"
vercel --prod        # deploys
```

Add storage in the dashboard as in Step 3 (it is the simplest route), then pull the variables for
local use:

```bash
vercel env pull .env.local
vercel --prod        # redeploy so the new variables apply
```

## Running it on your computer

- **Simple:** `npm start`, then open <http://localhost:3000>. Links are saved in `data/links.json`.
- **Same storage as production:** `vercel env pull .env.local`, then `vercel dev`. This uses your real Redis, so links you add locally appear on the live site.

---

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| "Storage is not set up yet" when adding | The Redis variables are missing, or you have not redeployed since adding them. Check Settings → Environment Variables, then Redeploy (Step 3). |
| "The shelf could not be read" or "could not be saved" | The Redis token is wrong or the database was deleted. Reconnect it under the Storage tab and redeploy. Function logs: project → **Logs**. |
| "GitHub is rate limiting requests" | Add `GITHUB_TOKEN` (Step 4), or wait a few minutes. |
| "GitHub could not find that repository" | Check the spelling. Private repositories cannot be read without a token that has access, and this app only supports public ones. |
| Page loads but has no styling | Redeploy. `vercel.json` bundles `public/`; make sure it was committed. |
| `/add` shows the form but nothing happens | A browser extension or cached script may be interfering. Hard-reload. The form also works with JavaScript off. |
| Changes do not appear after a push | Check the **Deployments** tab. A failed build keeps serving the previous version. |

## Good to know

- **Anyone with the link can add repositories.** The site has no sign-in. For a personal shelf, keep the address private, or turn on **Settings → Deployment Protection** (the strongest options need a paid plan). If you want a passcode on **Add a link** only, that is a small addition: ask for it.
- **There is no delete button yet.** To remove an entry, open your Upstash database's **Data Browser** and delete the field under the key `skillshelf:links`.
- **Your data lives in Upstash**, not in the repository. Export it from the Upstash console if you want a backup.
- **Custom domain:** Project → **Settings → Domains**.
