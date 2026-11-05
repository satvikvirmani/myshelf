'use strict';
// Storage for the shelf.
//  - Redis over REST (Upstash, installed from the Vercel Marketplace): used whenever its env vars exist.
//  - A local JSON file (data/links.json): development only.
//  - On Vercel with no Redis configured, saving is refused with a clear message rather than losing data.
const fs = require('fs');
const path = require('path');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = 'skillshelf:links'; // a hash: field = lowercase "owner/repo", value = JSON
const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'links.json');
const useRedis = () => Boolean(REDIS_URL && REDIS_TOKEN);
const onVercel = () => Boolean(process.env.VERCEL);

const NOT_CONFIGURED = Object.assign(new Error('storage not configured'), {
  userMessage: 'Storage is not set up yet, so links cannot be saved. See DEPLOY.md, step 3.',
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

async function list() {
  if (useRedis()) {
    const raw = await redis(['HGETALL', KEY]);
    const values = Array.isArray(raw)
      ? raw.filter((_, i) => i % 2 === 1)           // flat [field, value, ...]
      : Object.values(raw || {});                   // or an object
    return values.map((v) => (typeof v === 'string' ? JSON.parse(v) : v))
      .sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
  }
  if (onVercel()) return [];
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}

async function add(link) {
  if (useRedis()) {
    await redis(['HSET', KEY, link.fullName.toLowerCase(), JSON.stringify(link)]);
    return;
  }
  if (onVercel()) throw NOT_CONFIGURED;
  const links = await list();
  links.push(link);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(links, null, 2));
}

module.exports = { list, add };
