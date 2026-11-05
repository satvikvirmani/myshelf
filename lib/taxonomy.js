'use strict';
// Category helpers. The goal is consistency: "technology", "Technologies" and "Technology"
// must all end up as the same node, and a new site must reuse the labels already in the tree.

const SMALL = new Set(['and', 'or', 'of', 'for', 'the', 'in', 'to', 'a', 'an', 'on', 'with', 'vs']);
const ACRONYMS = {
  ai: 'AI', api: 'API', apis: 'APIs', ui: 'UI', ux: 'UX', ar: 'AR', vr: 'VR', '3d': '3D', seo: 'SEO',
  saas: 'SaaS', diy: 'DIY', it: 'IT', hr: 'HR', crm: 'CRM', erp: 'ERP', nft: 'NFT', sql: 'SQL',
  css: 'CSS', html: 'HTML', ml: 'ML', llm: 'LLM', llms: 'LLMs', gpu: 'GPU', cpu: 'CPU', iot: 'IoT',
  pdf: 'PDF', usb: 'USB', tv: 'TV', vpn: 'VPN', b2b: 'B2B', b2c: 'B2C', ngo: 'NGO', faq: 'FAQ',
};

/** Trim, strip markup and separators, collapse spaces, cap the length. */
function clean(s, max = 40) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f<>]/g, ' ')
    .replace(/[\/\\|›»]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:;,.#]+|[\s\-–—:;,.]+$/g, '')
    .slice(0, max)
    .trim();
}

function capitalise(w) {
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function titleCase(s) {
  return clean(s).split(' ').map((word, i) => {
    if (!word) return word;
    const lower = word.toLowerCase();
    if (ACRONYMS[lower]) return ACRONYMS[lower];
    if (/[A-Z].*[A-Z]/.test(word)) return word;                 // SaaS, GitHub, iPhone-like: keep
    if (i > 0 && SMALL.has(lower)) return lower;
    return lower.split('-').map(capitalise).join('-');
  }).join(' ');
}

/** Comparison key: case, punctuation, "&" vs "and", and simple plurals are ignored. */
function key(s) {
  let k = String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '');
  if (k.endsWith('ies') && k.length > 4) k = k.slice(0, -3) + 'y';
  else if (/(ches|shes|xes|sses|zes)$/.test(k)) k = k.slice(0, -2);
  else if (k.endsWith('s') && !k.endsWith('ss') && k.length > 3) k = k.slice(0, -1);
  return k;
}

function newNode(label) {
  return { label, key: key(label), sites: new Set(), ends: 0, children: new Map() };
}

/** Build the category tree from stored sites (oldest first, so the oldest label wins). */
function buildTree(sites) {
  const root = newNode('');
  const ordered = [...sites].sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
  for (const site of ordered) {
    for (const path of site.categories || []) {
      let node = root;
      path.forEach((seg, i) => {
        const k = key(seg);
        let child = node.children.get(k);
        if (!child) { child = newNode(seg); node.children.set(k, child); }
        child.sites.add(site.id);
        if (i === path.length - 1) child.ends++;
        node = child;
      });
    }
  }
  return root;
}

/**
 * Map a proposed path onto the existing tree. Existing nodes keep their stored label;
 * everything from the first unknown segment down is new.
 * Returns { path, newFrom } where newFrom is the index of the first new segment, or -1.
 */
function canonicalize(path, root) {
  const out = [];
  let node = root;
  let newFrom = -1;
  for (const seg of path) {
    const k = key(seg);
    if (out.length && key(out[out.length - 1]) === k) continue;  // "Technology › Technology"
    const child = node && node.children.get(k);
    if (child) { out.push(child.label); node = child; }
    else { if (newFrom < 0) newFrom = out.length; out.push(seg); node = null; }
  }
  return { path: out, newFrom };
}

/** Existing paths for the prompt, most used first, capped so the prompt stays small. */
function promptLines(root, limit = 300) {
  const rows = [];
  (function walk(node, trail) {
    for (const child of node.children.values()) {
      const next = [...trail, child.label];
      if (child.ends > 0) rows.push({ line: next.join(' > '), n: child.sites.size });
      walk(child, next);
    }
  })(root, []);
  return rows.sort((a, b) => b.n - a.n || a.line.localeCompare(b.line)).slice(0, limit).map((r) => r.line);
}

/** True when any of the site's category paths starts with the given key path. */
function matchesPath(site, keys) {
  if (!keys.length) return true;
  return (site.categories || []).some((p) => keys.every((k, i) => p[i] !== undefined && key(p[i]) === k));
}

const HUES = [158, 205, 28, 48, 232, 185, 95, 12]; // greens, blues, ambers, a red: nothing from 280 to 350 (violet and magenta)
function hueFor(label) {
  let h = 0;
  for (const ch of key(label)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

function slug(id) {
  return 's-' + String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { clean, titleCase, key, buildTree, canonicalize, promptLines, matchesPath, hueFor, slug };
