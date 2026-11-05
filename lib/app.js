'use strict';
// myShelf request handler, shared by the local server (server.js) and Vercel (api/index.js).
// Routes: GET /  GET /add  POST /add  GET /sites.json  GET /style.css  GET /app.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const tax = require('./taxonomy');
const cls = require('./classify');

const PUBLIC = path.join(__dirname, '..', 'public');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- optional passcode (protects the paid Gemini calls on a public URL) ---------- */

const passcodeRequired = () => Boolean(process.env.ADD_PASSCODE);
const passcodeOk = (given) => {
  const h = (s) => crypto.createHash('sha256').update(String(s ?? '')).digest();
  return crypto.timingSafeEqual(h(given), h(process.env.ADD_PASSCODE));
};

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

/* ---------- view helpers ---------- */

const LADDER = [ // the brief's own examples: kinds of site, never real entries
  ['An AI tools website', ['Technology', 'AI', 'AI Tools']],
  ['A watch store', ['Shopping', 'Accessories', 'Watches']],
  ['A jewellery brand', ['Shopping', 'Fashion', 'Jewellery']],
  ['A designer’s portfolio', ['Creative', 'Design', 'Portfolio']],
  ['A GitHub repository', ['Technology', 'Development', 'Open Source']],
  ['A shopping aggregator', ['Shopping', 'Marketplace', 'Product Aggregator']],
];

function href(p = {}) {
  const q = new URLSearchParams();
  for (const k of ['c', 'q', 'tag', 'sort']) if (p[k] && !(k === 'sort' && p[k] === 'new')) q.set(k, p[k]);
  const s = q.toString();
  return `/${s ? '?' + s : ''}#directory`;
}

function crumbs(pathArr, { link = true } = {}) {
  const segs = pathArr.map((seg, i) => link
    ? `<a class="seg" href="${href({ c: pathArr.slice(0, i + 1).join('/') })}">${esc(seg)}</a>`
    : `<span class="seg">${esc(seg)}</span>`);
  return `<span class="path" style="--hue:${tax.hueFor(pathArr[0])}"><span class="dot" aria-hidden="true"></span>${segs.join('<span class="sep" aria-hidden="true">›</span>')}</span>`;
}

function renderTree(node, trail, selKeys, depth) {
  const kids = [...node.children.values()].sort((a, b) => b.sites.size - a.sites.size || a.label.localeCompare(b.label));
  return `<ul class="tree${depth ? ' tree-sub' : ''}">` + kids.map((child) => {
    const p = [...trail, child.label];
    const keys = p.map(tax.key);
    const onPath = selKeys.length >= keys.length && keys.every((k, i) => selKeys[i] === k);
    const isSel = onPath && selKeys.length === keys.length;
    const dot = depth === 0 ? `<span class="dot" style="--hue:${tax.hueFor(child.label)}" aria-hidden="true"></span>` : '';
    const link = `<a href="${href({ c: p.join('/') })}"${isSel ? ' aria-current="page"' : ''}>${dot}<span class="tl">${esc(child.label)}</span><span class="tc">${child.sites.size}</span></a>`;
    if (!child.children.size) return `<li${isSel ? ' class="sel"' : ''}>${link}</li>`;
    return `<li${isSel ? ' class="sel"' : ''}><details${depth === 0 || onPath ? ' open' : ''}><summary>${link}</summary>${renderTree(child, p, selKeys, depth + 1)}</details></li>`;
  }).join('') + '</ul>';
}

function confidence(c) {
  const pct = Math.round((c ?? 0) * 100);
  const label = pct >= 80 ? 'High' : pct >= 50 ? 'Medium' : 'Low';
  return { pct, label, low: pct < 50 };
}

function renderSite(s, addedId) {
  const sid = tax.slug(s.id);
  const conf = confidence(s.confidence);
  const created = new Set((s.created || []));
  const root = (s.categories?.[0]?.[0]) || s.name || '?';
  const cats = (s.categories || []).map((p) => `<li class="cat">${crumbs(p)}${created.has(p.join(' › ')) ? '<span class="badge badge-new">New category</span>' : ''}</li>`).join('');
  const tags = (s.tags || []).map((t) => `<li><a href="${href({ tag: t })}">#${esc(t)}</a></li>`).join('');
  return `
      <li class="site${s.id === addedId ? ' site--added' : ''}" id="${sid}">
        <span class="tile" style="--hue:${tax.hueFor(root)}" aria-hidden="true">${esc(String(s.name || '?').charAt(0).toUpperCase())}</span>
        <div class="site-main">
          <h3 class="site-name"><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.name)}</a></h3>
          <p class="site-host">${esc(s.host)}</p>
          ${s.description ? `<p class="site-desc">${esc(s.description)}</p>` : ''}
          <ul class="cats" aria-label="Categories">${cats}</ul>
          ${tags ? `<ul class="tags" aria-label="Tags">${tags}</ul>` : ''}
        </div>
        <div class="site-side">
          <p class="conf${conf.low ? ' conf-low' : ''}" title="How sure the AI is that these categories fit">
            <span class="conf-bar" aria-hidden="true"><i style="width:${conf.pct}%"></i></span>
            <span class="conf-text"><strong>${conf.pct}%</strong> ${conf.label.toLowerCase()}<span class="sr"> confidence</span></span>
          </p>
          ${conf.low ? '<span class="badge badge-low">Worth a check</span>' : ''}
          <a class="site-go" href="${esc(s.url)}" rel="noopener noreferrer" aria-label="Visit ${esc(s.name)}">Visit <span aria-hidden="true">↗</span></a>
        </div>
      </li>`;
}

function applyFilters(sites, { c, q, tag, sort }) {
  const keys = c ? c.split('/').map(tax.key).filter(Boolean) : [];
  let out = sites.filter((s) => tax.matchesPath(s, keys));
  if (tag) out = out.filter((s) => (s.tags || []).includes(tag));
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter((s) => [s.name, s.host, s.description, (s.tags || []).join(' '),
      (s.categories || []).map((p) => p.join(' ')).join(' ')].join(' ').toLowerCase().includes(needle));
  }
  if (sort === 'az') out.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  else if (sort === 'conf') out.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  else out.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
  return { out, keys };
}

function addForm(id, { value = '', error = '', from }) {
  return `
    <label class="sr" for="${id}-url">Website address</label>
    <input id="${id}-url" name="url" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
           placeholder="example.com or https://example.com/page" required value="${esc(value)}"
           aria-describedby="${id}-hint${error ? ` ${id}-error` : ''}"${error ? ' aria-invalid="true"' : ''}>
    ${passcodeRequired() ? `<label class="field-label" for="${id}-pass">Passcode</label>
    <input id="${id}-pass" class="pass" name="passcode" type="password" autocomplete="off" required>` : ''}
    <input type="hidden" name="from" value="${from}">`;
}

function renderPage({ sites, query = {}, added, error, value, from, showAdd }) {
  const tree = tax.buildTree(sites);
  const { out, keys } = applyFilters(sites, query);
  const count = sites.length;
  const compact = count > 0;
  const addedSite = added ? sites.find((s) => s.id === added) : null;

  // active filter chips
  const chips = [];
  if (keys.length) {
    let node = tree; const labels = [];
    for (const k of keys) { node = node && node.children.get(k); labels.push(node ? node.label : k); }
    chips.push(`<li><a class="chip" href="${href({ ...query, c: '' })}" aria-label="Remove category filter ${esc(labels.join(' › '))}">${esc(labels.join(' › '))} <span aria-hidden="true">✕</span></a></li>`);
  }
  if (query.tag) chips.push(`<li><a class="chip" href="${href({ ...query, tag: '' })}" aria-label="Remove tag filter ${esc(query.tag)}">#${esc(query.tag)} <span aria-hidden="true">✕</span></a></li>`);
  if (query.q) chips.push(`<li><a class="chip" href="${href({ ...query, q: '' })}" aria-label="Remove search ${esc(query.q)}">“${esc(query.q)}” <span aria-hidden="true">✕</span></a></li>`);

  let results;
  if (!count) {
    results = `<div class="empty">
        <h3>Nothing is filed yet.</h3>
        <p>Nothing is pre-filled, so the directory starts empty. To file your first website:</p>
        <ol class="empty-steps">
          <li>Paste a website address into the box at the top, or choose <strong>Add a website</strong>.</li>
          <li>The AI reads the site and works out what it is for.</li>
          <li>It appears here with its name, a description, categories, tags and a confidence score, and the category tree on the left grows to match.</li>
        </ol>
        <a class="btn btn-primary" href="/add" data-open-add>Add your first website</a>
      </div>`;
  } else if (!out.length) {
    results = `<div class="empty"><h3>No websites match.</h3><p>Try a broader category or a different search.</p><a class="btn btn-quiet" href="/#directory">Clear filters</a></div>`;
  } else {
    results = `<ol class="sites">${out.map((s) => renderSite(s, added)).join('')}\n    </ol>`;
  }

  const heroErr = from === 'hero' && error;
  const dlgErr = from !== 'hero' && error;
  const primaryPath = addedSite?.categories?.[0];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>myShelf: AI website directory</title>
<meta name="description" content="Paste any website link. An AI reads it and files it in a category tree with tags and a confidence score.">
<meta name="color-scheme" content="light dark">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<a class="skip" href="#directory">Skip to the directory</a>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="/" aria-label="myShelf, home"><span class="brand-mark" aria-hidden="true">›</span>myShelf</a>
    <nav class="bar-nav" aria-label="Primary">
      <a class="bar-link" href="/#directory">Directory</a>
      <a class="btn btn-small btn-primary" href="/add" data-open-add>Add a website</a>
    </nav>
  </div>
</header>

<section class="hero${compact ? ' hero--compact' : ''}" aria-labelledby="hero-title">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="kicker">AI website directory</p>
      <h1 id="hero-title">Paste a link.<br>The website files itself.</h1>
      <p class="lede">myShelf reads each site, works out what it offers, and places it in a category tree with tags and a confidence score.</p>
      <form class="hero-form" method="post" action="/add" data-classify novalidate>
        ${addForm('hero', { value: from === 'hero' ? value : '', error: heroErr, from: 'hero' })}
        <button class="btn btn-primary" type="submit" data-submit><span class="label">Classify website</span><span class="busy" hidden>Reading the site…</span></button>
      </form>
      ${heroErr ? `<p class="error" id="hero-error" role="alert">${esc(error)}</p>` : ''}
      <p class="fine progress-wrap" id="hero-hint"><span class="hint-text">Public websites only. Reading a site takes 5 to 20 seconds.</span><span class="progress" role="status" hidden>The AI is reading the website. This can take up to 20 seconds.</span></p>
    </div>
    ${compact ? '' : `<div class="ladder" role="group" aria-label="How different kinds of websites get filed">
      <p class="ladder-head"><span>URL in</span><span aria-hidden="true">→</span><span>Categories out</span></p>
      <ul>
        ${LADDER.map(([kind, p]) => `<li><span class="kind">${esc(kind)}</span>${crumbs(p, { link: false })}</li>`).join('\n        ')}
      </ul>
    </div>`}
  </div>
</section>

<section id="directory" class="directory" aria-labelledby="dir-title">
  <div class="wrap dir-grid">
    <aside class="tree-col">
      <details class="tree-box" open data-tree-box${keys.length || query.tag || query.q ? ' data-active' : ''}>
        <summary class="tree-title"><span id="dir-title">Categories</span></summary>
        <nav aria-label="Categories">
          <a class="tree-all${keys.length ? '' : ' sel'}" href="${href({})}"${keys.length ? '' : ' aria-current="page"'}><span class="tl">All websites</span><span class="tc">${count}</span></a>
          ${count ? renderTree(tree, [], keys, 0) : '<p class="tree-empty">Categories appear here as websites are filed.</p>'}
        </nav>
      </details>
    </aside>

    <div class="results">
      ${addedSite ? `<p class="notice" role="status">Filed <strong>${esc(addedSite.name)}</strong> under ${crumbs(primaryPath, { link: false })}${addedSite.created?.length ? ' <span class="badge badge-new">New category</span>' : ''}</p>` : ''}
      <form class="toolbar" method="get" action="/#directory" role="search">
        ${keys.length ? `<input type="hidden" name="c" value="${esc(query.c)}">` : ''}
        ${query.tag ? `<input type="hidden" name="tag" value="${esc(query.tag)}">` : ''}
        <div class="search">
          <label class="sr" for="q">Search the directory</label>
          <input id="q" name="q" type="search" placeholder="Search names, tags, descriptions" value="${esc(query.q || '')}" autocomplete="off">
          <button class="btn btn-quiet btn-small" type="submit">Search</button>
        </div>
        <div class="sort">
          <label for="sort">Order</label>
          <select id="sort" name="sort" data-autosubmit>
            <option value="new"${query.sort !== 'az' && query.sort !== 'conf' ? ' selected' : ''}>Newest first</option>
            <option value="az"${query.sort === 'az' ? ' selected' : ''}>Name, A to Z</option>
            <option value="conf"${query.sort === 'conf' ? ' selected' : ''}>Most confident</option>
          </select>
        </div>
      </form>
      <div class="status-row">
        <p class="count" aria-live="polite"><strong>${out.length}</strong> ${count && out.length !== count ? `of ${count} ` : ''}${out.length === 1 ? 'website' : 'websites'}</p>
        ${chips.length ? `<ul class="chips" aria-label="Active filters">${chips.join('')}</ul>` : ''}
      </div>
      ${results}
    </div>
  </div>
</section>

<footer class="foot"><div class="wrap"><p>Categories are suggested by an AI that reads each public website. Check anything important.</p></div></footer>

<dialog id="add-dialog" class="dialog"${showAdd ? ' open' : ''} aria-labelledby="add-title">
  <form method="post" action="/add" class="add-form" data-classify novalidate>
    <div class="dialog-head">
      <h2 id="add-title">Add a website</h2>
      <a class="close" href="/" data-close aria-label="Close">Close <span aria-hidden="true">✕</span></a>
    </div>
    <p class="hint" id="dialog-hint">Paste any public website address. The AI reads it and files it for you.</p>
    <label class="field-label" for="dialog-url">Website address</label>
    ${addForm('dialog', { value: from !== 'hero' ? value : '', error: dlgErr, from: 'dialog' }).replace('<label class="sr" for="dialog-url">Website address</label>', '')}
    ${dlgErr ? `<p class="error" id="dialog-error" role="alert">${esc(error)}</p>` : ''}
    <p class="progress" role="status" hidden>The AI is reading the website. This can take up to 20 seconds.</p>
    <div class="dialog-actions">
      <button class="btn btn-primary" type="submit" data-submit><span class="label">Classify and add</span><span class="busy" hidden>Reading the site…</span></button>
      <a class="btn btn-quiet" href="/" data-close>Cancel</a>
    </div>
  </form>
</dialog>
<script src="/app.js" defer></script>
</body>
</html>`;
}

/* ---------- routes ---------- */

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
  const p = (k, max = 200) => String(url.searchParams.get(k) || '').slice(0, max).trim();
  try {
    if (req.method === 'GET' && (pathname === '/style.css' || pathname === '/app.js')) {
      const file = path.join(PUBLIC, pathname.slice(1));
      return send(200, fs.readFileSync(file), TYPES[path.extname(file)], { 'Cache-Control': 'public, max-age=300' });
    }
    if (req.method === 'GET' && pathname === '/sites.json') {
      return send(200, JSON.stringify(await store.list(), null, 2), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
    }
    if (req.method === 'GET' && (pathname === '/' || pathname === '/add')) {
      const query = { c: p('c'), q: p('q'), tag: p('tag'), sort: p('sort', 10) };
      return send(200, renderPage({ sites: await store.list(), query, added: p('added', 300), showAdd: pathname === '/add' }));
    }
    if (req.method === 'POST' && pathname === '/add') {
      const body = await readBody(req);
      const from = body.from === 'hero' ? 'hero' : 'dialog';
      const value = String(body.url || '').trim().slice(0, 2048);
      const fail = async (error, code = 422) => {
        let sites = [];
        try { sites = await store.list(); } catch { /* the page still renders the form and message */ }
        return send(code, renderPage({ sites, error, value, from, showAdd: from !== 'hero' }));
      };
      if (passcodeRequired() && !passcodeOk(body.passcode)) return fail('That passcode is not right.', 403);
      const addr = cls.normalizeUrl(value);
      if (addr.error) return fail(addr.error);
      let sites;
      try { sites = await store.list(); } catch (e) { console.error(e); return fail(e.userMessage || 'The directory could not be read. Try again shortly.', 503); }
      if (sites.some((s) => s.id === addr.id)) return fail('That website is already in the directory.', 409);
      if (!store.isConfigured()) return fail(store.NOT_CONFIGURED.userMessage, 503); // before any paid AI call
      let record;
      try { record = await cls.classify(addr, sites); }
      catch (e) { if (!e.userMessage) console.error(e); return fail(e.userMessage || 'Something went wrong while classifying. Try again.', e.status || 502); }
      try { await store.add(record); }
      catch (e) { console.error(e); return fail(e.userMessage || 'The website could not be saved. Try again shortly.', 503); }
      return send(303, '', 'text/plain', { Location: `/?added=${encodeURIComponent(record.id)}#${tax.slug(record.id)}` });
    }
    send(404, '<!doctype html><title>Not found</title><p>Not found. <a href="/">Back to myShelf</a></p>');
  } catch (e) {
    console.error(e);
    send(500, '<!doctype html><title>Error</title><p>Something went wrong. <a href="/">Back to myShelf</a></p>');
  }
}

module.exports = handler;
