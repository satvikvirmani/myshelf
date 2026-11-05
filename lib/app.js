'use strict';
// Skill Shelf request handler, shared by the local server (server.js) and Vercel (api/index.js).
// Routes: GET /  GET /add  POST /add  GET /style.css  GET /app.js
const fs = require('fs');
const path = require('path');
const store = require('./store');

const PUBLIC = path.join(__dirname, '..', 'public');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Accepts https://github.com/owner/repo(.git)(/...), github.com/owner/repo, or owner/repo.
function parseRepo(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i)
        || s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function fetchRepo({ owner, repo }) {
  let res;
  try {
    res = await fetch(`${process.env.GITHUB_API || 'https://api.github.com'}/repos/${owner}/${repo}`, {
      headers: { 'User-Agent': 'skill-shelf', Accept: 'application/vnd.github+json',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { error: 'Could not reach GitHub to read that repository. Check your connection and try again.' };
  }
  if (res.status === 404) return { error: 'GitHub could not find that repository. Check the spelling, and that it is public.', code: 422 };
  if (res.status === 403 || res.status === 429) return { error: 'GitHub is rate limiting requests right now. Try again in a few minutes.' };
  if (!res.ok) return { error: `GitHub answered with status ${res.status}. Try again shortly.` };
  const j = await res.json();
  return { name: j.name, owner: j.owner.login, fullName: j.full_name, description: j.description || '', url: j.html_url };
}

function readBody(req) {
  if (req.body !== undefined && req.body !== null) { // Vercel has already parsed it
    if (Buffer.isBuffer(req.body)) return Promise.resolve(Object.fromEntries(new URLSearchParams(req.body.toString())));
    if (typeof req.body === 'string') return Promise.resolve(Object.fromEntries(new URLSearchParams(req.body)));
    return Promise.resolve(req.body);
  }
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e5) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(b))));
    req.on('error', reject);
  });
}

function renderEntry(l, i) {
  const n = String(i + 1).padStart(2, '0');
  return `
      <li class="entry">
        <span class="entry-no" aria-hidden="true">${n}</span>
        <div class="entry-body">
          <h3 class="entry-name"><a href="${esc(l.url)}" rel="noopener noreferrer"><span class="owner">${esc(l.owner)}/</span>${esc(l.name)}</a></h3>
          ${l.description
            ? `<p class="entry-desc">${esc(l.description)}</p>`
            : `<p class="entry-desc none">This repository has no description on GitHub.</p>`}
        </div>
        <a class="entry-go" href="${esc(l.url)}" rel="noopener noreferrer" aria-label="Open ${esc(l.fullName)} on GitHub">Open on GitHub <span aria-hidden="true">↗</span></a>
      </li>`;
}

function renderPage({ links, sort, added, error, value, showAdd }) {
  const sorted = [...links];
  if (sort === 'az') sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  else sorted.reverse(); // newest first
  const count = links.length;

  const list = count
    ? `<ol class="entries">${sorted.map(renderEntry).join('')}\n    </ol>`
    : `<div class="empty">
        <p class="empty-title">The shelf is empty.</p>
        <p>Nothing has been added yet, and nothing is pre-filled. To add your first repository:</p>
        <ol class="empty-steps">
          <li>Choose <strong>Add a link</strong>.</li>
          <li>Paste a GitHub address, such as <code>github.com/owner/repo</code>, or just <code>owner/repo</code>.</li>
          <li>Submit. The repository's name and description are read from GitHub and shown here.</li>
        </ol>
        <a class="btn btn-primary" href="/add" data-open-add>Add your first link</a>
      </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skill Shelf</title>
<meta name="description" content="A hand-picked index of GitHub repositories worth keeping.">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<a class="skip" href="#collection">Skip to the collection</a>
<div class="page">
  <header class="masthead">
    <p class="kicker">A personal index</p>
    <h1>Skill<br>Shelf</h1>
    <p class="lede">GitHub repositories worth keeping close: one name, one line on what it does, one link.</p>
    <div class="masthead-actions">
      <a class="btn btn-primary" href="/add" data-open-add>Add a link</a>
      <p class="tally" aria-live="polite"><strong>${count}</strong> ${count === 1 ? 'repository' : 'repositories'}</p>
    </div>
  </header>

  <main id="collection" class="collection" tabindex="-1">
    ${added ? `<p class="notice" role="status">Added <strong>${esc(added)}</strong> to the shelf.</p>` : ''}
    <div class="toolbar">
      <h2>The collection</h2>
      ${count > 1 ? `<form class="sort" method="get" action="/">
        <label for="sort">Order</label>
        <select id="sort" name="sort" data-autosubmit>
          <option value="new"${sort !== 'az' ? ' selected' : ''}>Newest first</option>
          <option value="az"${sort === 'az' ? ' selected' : ''}>Name, A to Z</option>
        </select>
        <noscript><button class="btn btn-quiet" type="submit">Apply</button></noscript>
      </form>` : ''}
    </div>
    ${list}
  </main>

  <footer class="foot">
    <p>Descriptions come straight from each repository on GitHub.</p>
  </footer>
</div>

<dialog id="add-dialog" class="dialog"${showAdd ? ' open' : ''} aria-labelledby="add-title">
  <form method="post" action="/add" class="add-form" novalidate>
    <div class="dialog-head">
      <h2 id="add-title">Add a link</h2>
      <a class="close" href="/" data-close aria-label="Close">Close <span aria-hidden="true">✕</span></a>
    </div>
    <p class="hint" id="url-hint">Paste a GitHub repository address. We read its name and description for you.</p>
    <label for="url">Repository URL</label>
    <input id="url" name="url" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
           placeholder="https://github.com/owner/repo" required value="${esc(value)}"
           aria-describedby="url-hint${error ? ' url-error' : ''}"${error ? ' aria-invalid="true"' : ''}>
    ${error ? `<p class="error" id="url-error" role="alert">${esc(error)}</p>` : ''}
    <div class="dialog-actions">
      <button class="btn btn-primary" type="submit" data-submit><span class="label">Add to the shelf</span><span class="busy" hidden>Adding…</span></button>
      <a class="btn btn-quiet" href="/" data-close>Cancel</a>
    </div>
  </form>
</dialog>
<script src="/app.js" defer></script>
</body>
</html>`;
}

const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  // vercel.json rewrites every path to /api?__p=<original path>, so read the route from there when present.
  const route = url.searchParams.get('__p');
  url.searchParams.delete('__p');
  const pathname = route ? (route.startsWith('/') ? route : '/' + route) : url.pathname;
  const send = (code, body, type = 'text/html; charset=utf-8', extra = {}) => {
    res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff',
      ...(type.startsWith('text/html') ? { 'Cache-Control': 'no-store' } : {}), ...extra });
    res.end(body);
  };
  try {
    if (req.method === 'GET' && (pathname === '/style.css' || pathname === '/app.js')) {
      const file = path.join(PUBLIC, pathname.slice(1));
      return send(200, fs.readFileSync(file), TYPES[path.extname(file)], { 'Cache-Control': 'public, max-age=300' });
    }
    if (req.method === 'GET' && pathname === '/') {
      return send(200, renderPage({ links: await store.list(), sort: url.searchParams.get('sort'), added: url.searchParams.get('added') }));
    }
    if (req.method === 'GET' && pathname === '/add') {
      return send(200, renderPage({ links: await store.list(), showAdd: true }));
    }
    if (req.method === 'POST' && pathname === '/add') {
      const body = await readBody(req);
      const value = String(body.url || '').trim();
      const fail = async (error, code = 422) => {
        let links = [];
        try { links = await store.list(); } catch { /* page still renders the form and message */ }
        return send(code, renderPage({ links, showAdd: true, error, value }));
      };
      if (!value) return fail('Enter a GitHub repository address.');
      const parsed = parseRepo(value);
      if (!parsed) return fail('That does not look like a GitHub repository. Try github.com/owner/repo.');
      const same = (l, n) => l.fullName.toLowerCase() === n.toLowerCase();
      let links;
      try { links = await store.list(); } catch (e) { return fail(e.userMessage || 'The shelf could not be read. Try again shortly.', 503); }
      if (links.some((l) => same(l, `${parsed.owner}/${parsed.repo}`))) return fail('That repository is already on the shelf.', 409);
      const repo = await fetchRepo(parsed);
      if (repo.error) return fail(repo.error, repo.code || 502);
      if (links.some((l) => same(l, repo.fullName))) return fail('That repository is already on the shelf.', 409);
      try { await store.add({ ...repo, addedAt: new Date().toISOString() }); }
      catch (e) { console.error(e); return fail(e.userMessage || 'The repository could not be saved. Try again shortly.', 503); }
      return send(303, '', 'text/plain', { Location: `/?added=${encodeURIComponent(repo.fullName)}#collection` });
    }
    send(404, '<!doctype html><title>Not found</title><p>Not found. <a href="/">Back to the shelf</a></p>');
  } catch (e) {
    console.error(e);
    send(500, '<!doctype html><title>Error</title><p>Something went wrong. <a href="/">Back to the shelf</a></p>');
  }
}

module.exports = handler;
