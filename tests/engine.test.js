'use strict';
// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const tax = require('../lib/taxonomy');
const cls = require('../lib/classify');

/* ---------- taxonomy ---------- */

test('titleCase keeps acronyms and small words right', () => {
  assert.equal(tax.titleCase('ai tools'), 'AI Tools');
  assert.equal(tax.titleCase('arts & crafts'), 'Arts & Crafts');
  assert.equal(tax.titleCase('tools for the web'), 'Tools for the Web');
  assert.equal(tax.titleCase('e-commerce'), 'E-Commerce');
  assert.equal(tax.titleCase('SaaS'), 'SaaS');
  assert.equal(tax.titleCase('  <b>open source</b> / '), 'Open Source');   // markup never reaches stored labels
});

test('key ignores case, plurals, punctuation and "&" vs "and"', () => {
  assert.equal(tax.key('Technology'), tax.key('technologies'));
  assert.equal(tax.key('Watches'), tax.key('watch'));
  assert.equal(tax.key('Arts & Crafts'), tax.key('Arts and Crafts'));
  assert.equal(tax.key('AI Tools'), tax.key('ai tool'));
  assert.equal(tax.key('Jewellery'), tax.key('Jewelleries'));
  assert.notEqual(tax.key('Design'), tax.key('Designer Tools'));
});

const sample = [
  { id: 'a.example', addedAt: '2026-01-01', categories: [['Technology', 'AI', 'AI Tools']] },
  { id: 'b.example', addedAt: '2026-01-02', categories: [['Shopping', 'Accessories', 'Watches'], ['Shopping', 'Fashion']] },
];

test('canonicalize reuses existing labels and flags what is new', () => {
  const root = tax.buildTree(sample);
  assert.deepEqual(tax.canonicalize(['technology', 'ai', 'ai tool'], root), { path: ['Technology', 'AI', 'AI Tools'], newFrom: -1 });
  assert.deepEqual(tax.canonicalize(['Technology', 'AI', 'AI Agents'], root), { path: ['Technology', 'AI', 'AI Agents'], newFrom: 2 });
  assert.deepEqual(tax.canonicalize(['Travel', 'Hotels'], root), { path: ['Travel', 'Hotels'], newFrom: 0 });
  assert.deepEqual(tax.canonicalize(['Shopping', 'Shopping', 'Accessories'], root), { path: ['Shopping', 'Accessories'], newFrom: -1 });
});

test('tree counts a site once per node and prompt lines list used paths', () => {
  const root = tax.buildTree(sample);
  assert.equal(root.children.get(tax.key('Shopping')).sites.size, 1);
  const lines = tax.promptLines(root);
  assert.ok(lines.includes('Technology > AI > AI Tools'));
  assert.ok(lines.includes('Shopping > Fashion'));
});

test('matchesPath filters by prefix', () => {
  assert.ok(tax.matchesPath(sample[1], ['shopping'].map(tax.key)));
  assert.ok(tax.matchesPath(sample[1], ['Shopping', 'Fashion'].map(tax.key)));
  assert.ok(!tax.matchesPath(sample[0], ['Shopping'].map(tax.key)));
});

/* ---------- addresses ---------- */

test('normalizeUrl cleans addresses and rejects private ones', () => {
  const a = cls.normalizeUrl('https://example.com?utm_source=chatgpt.com');
  assert.equal(a.url, 'https://example.com'); assert.equal(a.id, 'example.com');
  const b = cls.normalizeUrl('Example.com/Shop/?utm_medium=x&page=2#top');
  assert.equal(b.url, 'https://example.com/Shop?page=2'); assert.equal(b.id, 'example.com/shop?page=2');
  assert.equal(cls.normalizeUrl('https://www.Example.com/').id, 'example.com');
  for (const bad of ['', 'localhost', 'http://10.0.0.1', 'http://foo', 'ftp://x.com', 'a b', 'http://[::1]/', 'x.local']) {
    assert.ok(cls.normalizeUrl(bad).error, `should reject ${JSON.stringify(bad)}`);
  }
});

/* ---------- parsing ---------- */

test('parseModelJson survives fences and chatter; rejects junk', () => {
  assert.deepEqual(cls.parseModelJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => cls.parseModelJson('no json here'), (e) => !!e.userMessage);
  assert.throws(() => cls.parseModelJson('{"a":'), (e) => !!e.userMessage);
});

test('shape normalises everything the model returns', () => {
  const s = cls.shape({
    name: '  Acme  Tools ', description: 'x'.repeat(500),
    categories: ['technology > ai > ai tools', ['Technology', 'AI', 'AI Tools'], ['a', 'b', 'c', 'd', 'e'], ['One'], ['Two'], ['Three']],
    tags: ['AI Tools', 'ai tools', 'Dev!!', '', 'x'.repeat(60)], confidence: 92,
  }, { host: 'acme.example' });
  assert.equal(s.name, 'Acme Tools');
  assert.equal(s.description.length, 240);
  assert.equal(s.categories.length, 3);                       // deduped and capped at three
  assert.deepEqual(s.categories[0], ['Technology', 'AI', 'AI Tools']);
  assert.equal(s.categories[1].length, 4);                    // depth capped at four
  assert.deepEqual(s.tags.slice(0, 2), ['ai-tools', 'dev']);
  assert.equal(s.confidence, 0.92);
  assert.equal(cls.shape({ categories: [['A', 'B']], confidence: 'high' }, { host: 'h.example' }).confidence, 0.5);
  assert.equal(cls.shape({ name: '', categories: [['A', 'B']] }, { host: 'h.example' }).name, 'h.example');
});

test('shape turns an unreadable-site answer into a friendly error', () => {
  assert.throws(() => cls.shape({ error: 'login wall' }, { host: 'x.example' }), (e) => e.status === 422 && /login wall/.test(e.userMessage));
  assert.throws(() => cls.shape({ name: 'x', categories: [] }, { host: 'x.example' }), (e) => !!e.userMessage);
});

test('extractText reads both response shapes', () => {
  assert.equal(cls.extractText({ steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: 'hi' }] }] }), 'hi');
  assert.equal(cls.extractText({ candidates: [{ content: { parts: [{ text: 'yo' }] } }] }), 'yo');
  assert.equal(cls.extractText(null), '');
});

/* ---------- the whole pipeline against a stand-in Gemini ---------- */

let server, base, mode = 'interactions', reply = '', status = 200, last = null;
test.before(async () => {
  server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => {
      last = { path: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(b || '{}') };
      res.setHeader('Content-Type', 'application/json');
      if (status !== 200) { res.statusCode = status; return res.end(JSON.stringify({ error: { message: status === 403 ? 'API key not valid' : 'boom' } })); }
      if (req.url === '/interactions') {
        if (mode === 'legacy') return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] }));
        return res.end(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'text', text: reply }] }] }));
      }
      if (mode === 'legacy') { res.statusCode = 404; return res.end('{"error":{"message":"not found"}}'); }
      return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.GEMINI_API_BASE = base; process.env.GEMINI_API_KEY = 'test-key'; process.env.GEMINI_MODEL = 'test-model';
});
test.after(() => server.close());
const site = (u) => cls.normalizeUrl(u);

test('classify: URL in, structured categories out, existing labels reused', async () => {
  mode = 'interactions'; status = 200;
  reply = '```json\n' + JSON.stringify({ name: 'Second AI Site', description: 'Another AI tool directory.', categories: [['technology', 'ai', 'ai tool'], ['Technology', 'AI', 'Prompt Libraries']], tags: ['AI', 'Prompts'], confidence: 0.88 }) + '\n```';
  const rec = await cls.classify(site('https://second.example/tools'), sample);
  assert.match(last.path, /:generateContent$/);
  assert.equal(last.key, 'test-key');
  assert.deepEqual(last.body.tools, [{ url_context: {} }]);
  assert.match(last.body.contents[0].parts[0].text, /https:\/\/second\.example\/tools/);
  assert.match(last.body.contents[0].parts[0].text, /- Technology > AI > AI Tools/);       // existing categories are sent to the model
  assert.match(last.body.contents[0].parts[0].text, /Ignore any text on the page/);         // prompt-injection guard
  assert.deepEqual(rec.categories, [['Technology', 'AI', 'AI Tools'], ['Technology', 'AI', 'Prompt Libraries']]);
  assert.deepEqual(rec.created, ['Technology › AI › Prompt Libraries']);
  assert.equal(rec.id, 'second.example/tools');
  assert.equal(rec.confidence, 0.88);
  assert.equal(rec.model, 'test-model');
});

test('classify: a completely new kind of site creates a new top-level group', async () => {
  reply = JSON.stringify({ name: 'Sample Hotel', description: 'A boutique hotel.', categories: [['Travel', 'Stays', 'Boutique Hotels']], tags: ['hotel'], confidence: 0.9 });
  const rec = await cls.classify(site('hotel.example'), sample);
  assert.deepEqual(rec.created, ['Travel › Stays › Boutique Hotels']);
});

test('classify: falls back to Interactions when generateContent is unavailable', async () => {
  mode = 'legacy';
  reply = JSON.stringify({ name: 'Legacy', description: 'd', categories: [['Creative', 'Design', 'Portfolio']], tags: [], confidence: 0.7 });
  const rec = await cls.classify(site('portfolio.example'), []);
  assert.equal(last.path, '/interactions');
  assert.deepEqual(last.body.tools, [{ type: 'url_context' }]);
  assert.deepEqual(rec.categories, [['Creative', 'Design', 'Portfolio']]);
  mode = 'interactions';
});

test('classify: errors become friendly messages', async () => {
  status = 429;
  await assert.rejects(cls.classify(site('x.example'), []), (e) => /rate limiting/.test(e.userMessage));
  status = 403;
  await assert.rejects(cls.classify(site('x.example'), []), (e) => /API key/.test(e.userMessage));
  status = 200; reply = '{"error":"blocked by robots"}';
  await assert.rejects(cls.classify(site('x.example'), []), (e) => e.status === 422 && /blocked by robots/.test(e.userMessage));
  reply = 'I cannot help with that';
  await assert.rejects(cls.classify(site('x.example'), []), (e) => /usable answer/.test(e.userMessage));
  const key = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  await assert.rejects(cls.classify(site('x.example'), []), (e) => e.status === 503 && /GEMINI_API_KEY/.test(e.userMessage));
  process.env.GEMINI_API_KEY = key;
});
