'use strict';
// Storage for classified websites.
//  - Redis over REST (Upstash, from the Vercel Marketplace) whenever its env vars exist.
//  - A local JSON file (data/sites.json) for development only.
//  - On Vercel with no Redis configured, saving is refused with a clear message instead of losing data.
const fs = require('fs');
const path = require('path');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'myshelf:sites'; // a hash: field = site id (host + path), value = JSON record
const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'sites.json');
const useRedis = () => Boolean(REDIS_URL && REDIS_TOKEN);
const onVercel = () => Boolean(process.env.VERCEL);

const NOT_CONFIGURED = Object.assign(new Error('storage not configured'), {
  userMessage: 'Storage is not set up yet, so websites cannot be saved. See DEPLOY.md, step 3.',
});

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `Redis responded with ${res.status}`);
  return json.result;
}

/** All sites, oldest first. */
async function list() {
  let sites;
  if (useRedis()) {
    const raw = await redis(['HGETALL', KEY]);
    const values = Array.isArray(raw) ? raw.filter((_, i) => i % 2 === 1) : Object.values(raw || {});
    sites = values.map((v) => (typeof v === 'string' ? JSON.parse(v) : v));
  } else if (onVercel()) {
    sites = [];
  } else {
    try { sites = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { sites = []; }
  }
  return sites.sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
}

async function add(site) {
  if (useRedis()) { await redis(['HSET', KEY, site.id, JSON.stringify(site)]); return; }
  if (onVercel()) throw NOT_CONFIGURED;
  const sites = await list();
  sites.push(site);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(sites, null, 2));
}

/** False on Vercel without Redis: saving is impossible, so callers should refuse before doing paid work. */
const isConfigured = () => useRedis() || !onVercel();

module.exports = { list, add, isConfigured, NOT_CONFIGURED };
