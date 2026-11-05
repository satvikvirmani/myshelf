# Deploying myShelf to Vercel

About 15 minutes. You need a GitHub account, a Vercel account (the free Hobby plan works) and a
Google AI Studio account for a Gemini API key.

## How it works

Paste a website address. myShelf sends it to Gemini, which reads the site with its **URL context**
tool and returns a name, a description, one to three category paths (such as
`Technology › AI › AI Tools`), tags and a confidence score. myShelf then reuses the category names
already in your directory, so the tree stays consistent, and creates new subcategories or
new top-level groups only when nothing fits.

| Piece | Where it runs | Notes |
|---|---|---|
| `lib/app.js` | everywhere | The pages and routes (`/`, `/add`, `/sites.json`). One handler shared by both entry points. |
| `lib/classify.js` | everywhere | Builds the prompt, calls Gemini, validates the answer strictly. |
| `lib/taxonomy.js` | everywhere | Category tree, name matching (case, plurals, "&" vs "and") and counts. |
| `lib/store.js` | everywhere | Redis (Upstash) when configured; a local JSON file for development only. |
| `server.js` | your computer | `npm start` serves it on port 3000. |
| `api/index.js` + `vercel.json` | Vercel | Runs the same handler as one serverless function (60 second limit). |

Vercel functions cannot save files, so **a Redis store is required in production** (step 4).

---

## Step 1: Get a Gemini API key

1. Open <https://aistudio.google.com/> and choose **Get API key**.
2. Create a key and keep it somewhere private. Never commit it to the repository.

A free tier exists, with usage limits. Each website you add makes one Gemini request.

## Step 2: Put the project on GitHub

```bash
git init
git add .
git commit -m "myShelf"
git branch -M main
git remote add origin https://github.com/<you>/myshelf.git
git push -u origin main
```

`.gitignore` already keeps `.env` files and `.vercel/` out of the repository.

## Step 3: Import it into Vercel

1. Go to <https://vercel.com/new> and import your `myshelf` repository.
2. Leave **Framework Preset** as **Other**, and leave Build Command, Output Directory and Install Command empty. There is no build step.
3. Choose **Deploy**. The first deployment will load, but adding websites will not work until steps 4 and 5.

## Step 4: Add storage (required)

1. In the Vercel project, open the **Storage** tab.
2. Under **Marketplace Database Providers**, choose **Upstash**, then **Redis** (the free plan is enough).
3. Create it, then connect it to this project for all environments.

Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` for you. myShelf also accepts
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` if you made the database at upstash.com.

## Step 5: Add your environment variables

In **Settings → Environment Variables**, add:

| Name | Value | Needed? |
|---|---|---|
| `GEMINI_API_KEY` | the key from step 1 | **Required** |
| `ADD_PASSCODE` | any phrase you choose | **Strongly recommended** on a public URL. Without it, anyone with the link can spend your Gemini quota. |
| `GEMINI_MODEL` | a model id, for example one you have tested | Optional. Defaults to `gemini-flash-latest`, Google's alias for the current Flash model. |

Then **Deployments → ⋯ → Redeploy**. Variables only apply to new deployments.

The model must support the **URL context** tool. If Google retires a model name, set `GEMINI_MODEL`
to a current one, or leave it unset to follow the alias.

## Step 6: Check that it works

1. Open your `*.vercel.app` address. You see the empty directory and the "URL in, categories out" examples.
2. Paste a real public website and choose **Classify website**. Reading takes roughly 5 to 20 seconds.
3. The page returns with **Filed &lt;name&gt; under &lt;categories&gt;**, and the category tree on the left shows the new path.
4. Add a second website of a similar kind. It should reuse the same category names.
5. Reload, then redeploy once. The entries are still there, so they are in Redis.

---

## Deploying from the command line instead

```bash
npm i -g vercel
vercel login
vercel link              # framework: Other
vercel env add GEMINI_API_KEY
vercel env add ADD_PASSCODE
vercel --prod
```

Add the Redis store from the dashboard (step 4), then `vercel env pull .env.local` and redeploy.

## Running it on your computer

```bash
GEMINI_API_KEY=your-key npm start      # http://localhost:3000, data in data/sites.json
npm test                               # the engine tests; no network or key needed
```

To use your real production data locally, `vercel env pull .env.local` and run `vercel dev`.

---

## Troubleshooting

| Message | Cause and fix |
|---|---|
| "Storage is not set up yet" | Redis variables are missing, or you have not redeployed since adding them (step 4). Nothing is sent to Gemini in this case. |
| "The AI is not set up yet" | `GEMINI_API_KEY` is missing or you have not redeployed (step 5). |
| "Gemini rejected the API key" | The key is wrong, revoked or restricted. Create a new one and update the variable. |
| "Gemini is rate limiting requests" | Free-tier limit reached. Wait a minute, or move to a paid key. |
| "Gemini returned an error (404)" | The model name is not available. Remove `GEMINI_MODEL` or set a current model id. |
| "The AI could not read that website" | The site blocks automated readers, needs a login, is empty, or is not a normal web page. Try a more specific public page. |
| "Reading that website took too long" | Slow site. Try again, or use a lighter page of the same site. |
| "That passcode is not right" | `ADD_PASSCODE` is set, and the passcode field does not match. |
| "That website is already in the directory" | Addresses are compared without `www.`, tracking parameters (`utm_*`) or a trailing slash. |
| No styling | Redeploy. Make sure `public/` was committed. |

Function logs: Vercel project → **Logs**.

## Good to know

- **The AI can be wrong.** Each entry shows a confidence score. Entries below 50% are flagged "Worth a check". Confidence is the model's own estimate, not a measured accuracy.
- **Consistency rule.** A new site is matched against existing category names ignoring case, plurals and "&" versus "and". The first spelling filed becomes the name everyone else uses.
- **Private pages are out of reach.** Only public pages that allow automated reading can be classified.
- **Export.** `/sites.json` returns every record (name, description, categories, tags, confidence, model, date).
- **No delete or edit yet.** To remove an entry, open your Upstash database's **Data Browser** and delete the field under the key `myshelf:sites`.
- **Scale.** Each page view reads all records from Redis, which is fine for a few thousand sites. Beyond that, the next step is paging in the store.
- **Cost.** One Gemini request per added website. The passcode (step 5) is your protection against strangers adding sites.
