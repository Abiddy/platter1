// Foodol server: guest app per restaurant (foodol.app/<slug>), one-time codes,
// restaurant portal (email + password), Foodol admin (password only).
// No dependencies. Data lives in DATA_DIR (a Railway volume in production):
//   restaurants.json  restaurants, their menus, free item and owner login
//   orders.jsonl      order + redeem events
//   guests.jsonl      guest emails per restaurant
//   secret            random key that signs login cookies
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const OWNER_KEY = process.env.OWNER_KEY || 'dev';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || OWNER_KEY;
const APP_URL = (process.env.APP_URL || 'https://www.foodol.app').replace(/\/$/, '');
const PUBLIC = path.join(__dirname, 'public');
const LOG = path.join(DATA_DIR, 'orders.jsonl');
const GUESTS_LOG = path.join(DATA_DIR, 'guests.jsonl');
const LEADS_LOG = path.join(DATA_DIR, 'leads.jsonl');
const REST_FILE = path.join(DATA_DIR, 'restaurants.json');
const FIRST = 'sausalido'; // the original restaurant; old data and old QR codes belong to it
// Old link names that now point at another restaurant (after a merge or rename).
const ALIAS_FILE = path.join(DATA_DIR, 'aliases.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- helpers ---------- */
const clean = (s, n = 80) => String(s ?? '').slice(0, n);
const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round((+v || 0) * 100) / 100));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const cleanEmail = (e) => { const v = String(e || '').trim().toLowerCase().slice(0, 120); return EMAIL_RE.test(v) ? v : ''; };
const escH = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RESERVED = new Set(['admin', 'portal', 'api', 'privacy', 'unsubscribe', 'owner', 'login', 'static', 'assets', 'index', 'app', 'www', 'foodol', 'help', 'terms']);
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40);
const validSlug = (s) => /^[a-z0-9][a-z0-9-]{1,39}$/.test(s) && !RESERVED.has(s);

function writeJSON(file, data) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1)); fs.renameSync(tmp, file); }

// Secret for signing cookies, kept on the volume so logins survive deploys.
const SECRET_FILE = path.join(DATA_DIR, 'secret');
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
const SECRET = process.env.SESSION_SECRET || fs.readFileSync(SECRET_FILE, 'utf8').trim();
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function makeToken(kind, sub, days) { const exp = Date.now() + days * 864e5; const body = `${kind}.${sub}.${exp}`; return body + '.' + sign(body); }
function readToken(tok, kind) {
  if (!tok) return null;
  const i = tok.lastIndexOf('.'); if (i < 0) return null;
  const body = tok.slice(0, i), mac = tok.slice(i + 1);
  const good = sign(body);
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  const [k, sub, exp] = body.split('.');
  if (k !== kind || +exp < Date.now()) return null;
  return sub;
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const cookieStr = (req, name, val, maxAge) => `${name}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') };
}
function checkPassword(pw, owner) {
  if (!owner || !owner.hash) return false;
  const h = crypto.scryptSync(String(pw), owner.salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(owner.hash, 'hex'));
}

// Simple brute-force guard for logins: 10 tries per 15 minutes per IP.
const tries = new Map();
function tooMany(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now(), t = (tries.get(ip) || []).filter((x) => now - x < 15 * 60e3);
  t.push(now); tries.set(ip, t);
  return t.length > 10;
}

/* ---------- restaurants ---------- */
// What guests can pick on the "What are you craving?" screen. Each restaurant can set its own;
// menus without a list use Sausalido's original four.
const DEFAULT_CRAVINGS = [
  { id: 'breakfast', label: 'Breakfast', img: '41101946-0e96-4010-b8b0-b3ed77a520e9' },
  { id: 'thai', label: 'Thai plates', img: 'ef1348d1-72d0-4ed7-8f84-505475182206' },
  { id: 'sandwich', label: 'Sandwiches', img: 'c59bdaf3-865d-4654-8242-a22608ab3560' },
  { id: 'sweet', label: 'Sweet & fresh', img: '59e60bcd-83ce-45c7-9dad-044bda9f8425' },
];
function cleanCravings(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = list.slice(0, 6).map((c) => ({
    id: String(c.id || slugify(c.label)).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20),
    label: clean(c.label, 24).trim(),
    emoji: clean(c.emoji, 8).trim() || undefined,
    img: /^[0-9a-f-]{36}$/.test(String(c.img || '')) ? c.img : undefined,
  })).filter((c) => c.id && c.label && c.id !== 'surprise' && !seen.has(c.id) && seen.add(c.id));
  return out.length ? out : null;
}
const cravingsOf = (menu) => menu.cravings || DEFAULT_CRAVINGS;
function cleanMenu(b) {
  const f = b.free || {};
  const cravings = cleanCravings(b.cravings);
  const CRAVES = (cravings || DEFAULT_CRAVINGS).map((c) => c.id);
  const seen = new Set();
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 300).map((i, n) => {
    let id = String(i.id || '').replace(/[^\w-]/g, '').slice(0, 24) || 'i' + n;
    while (seen.has(id)) id += 'x';
    seen.add(id);
    return {
      id, s: clean(i.s, 40) || 'Menu', n: clean(i.n, 60), d: clean(i.d, 140), p: num(i.p, 0, 500),
      c: (Array.isArray(i.c) ? i.c : []).filter((c) => CRAVES.includes(c)),
      k: ['main', 'side', 'drink'].includes(i.k) ? i.k : 'main', pop: Math.min(5, Math.max(1, Math.round(+i.pop || 3))), on: i.on !== false,
      ...(i.sq ? { sq: String(i.sq).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) } : {}),
    };
  }).filter((i) => i.n);
  const ids = new Set(items.filter((i) => i.k !== 'drink').map((i) => i.id));
  const popular = (Array.isArray(b.popular) ? b.popular : []).map((x) => String(x)).filter((x, k, a) => ids.has(x) && a.indexOf(x) === k).slice(0, 30);
  const menu = { free: { on: !!f.on, name: clean(f.name, 40) || 'free item', min: num(f.min, 0, 500), grace: num(f.grace ?? 0.5, 0, 5) }, items, popular };
  if (cravings) menu.cravings = cravings;
  return menu;
}

let aliases = {};
try { if (fs.existsSync(ALIAS_FILE)) aliases = JSON.parse(fs.readFileSync(ALIAS_FILE, 'utf8')); } catch { aliases = {}; }
const go = (slug) => { let x = slug; for (let k = 0; k < 8 && aliases[x]; k++) x = aliases[x]; return x; };
let restaurants = [];
if (fs.existsSync(REST_FILE)) {
  restaurants = JSON.parse(fs.readFileSync(REST_FILE, 'utf8'));
} else {
  // First boot after the multi-restaurant upgrade: Sausalido gets the existing menu.
  let m = JSON.parse(fs.readFileSync(path.join(__dirname, 'menu.default.json'), 'utf8'));
  try { const old = path.join(DATA_DIR, 'menu.json'); if (fs.existsSync(old)) m = JSON.parse(fs.readFileSync(old, 'utf8')); } catch { /* keep default */ }
  restaurants = [{ slug: FIRST, name: m.restaurant || 'Sausalido Cafe', menu: { free: m.free, items: m.items }, owner: null, createdAt: new Date().toISOString() }];
  writeJSON(REST_FILE, restaurants);
}
const saveRestaurants = () => writeJSON(REST_FILE, restaurants);
const findR = (slug) => { const s2 = go(slug); return restaurants.find((r) => r.slug === s2); };

/* ---------- orders ---------- */
const orders = new Map();
if (fs.existsSync(LOG)) {
  for (const line of fs.readFileSync(LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'order') orders.set(ev.order.id, { ...ev.order, r: go(ev.order.r || FIRST) });
      if (ev.type === 'redeem' && orders.has(ev.id)) orders.get(ev.id).redeemedAt = ev.at;
      if (ev.type === 'wipe') for (const [id, o] of orders) if (o.r === go(ev.r)) orders.delete(id);
    } catch { /* skip bad line */ }
  }
}
const append = (ev) => fs.appendFileSync(LOG, JSON.stringify(ev) + '\n');
function newCode(r) {
  for (;;) {
    const c = String(crypto.randomInt(1000, 10000));
    if (![...orders.values()].some((o) => o.r === r && o.code === c && !o.redeemedAt)) return c;
  }
}

/* ---------- guests (per restaurant) ---------- */
const guests = new Map(); // key "slug:email"
if (fs.existsSync(GUESTS_LOG)) {
  for (const line of fs.readFileSync(GUESTS_LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const raw = JSON.parse(line); if (raw.wipe) { for (const [k, x] of guests) if (x.r === go(raw.wipe)) guests.delete(k); continue; } const g = { ...raw, r: go(raw.r || FIRST) }; const k = g.r + ':' + g.email; const prev = guests.get(k); guests.set(k, prev ? { ...prev, ...g, orders: Math.max(prev.orders || 0, g.orders || 0), firstSeen: prev.firstSeen < g.firstSeen ? prev.firstSeen : g.firstSeen } : g); } catch { /* skip */ }
  }
}
function upsertGuest(r, email, patch) {
  const now = new Date().toISOString(), k = r + ':' + email;
  const g = { r, email, firstSeen: now, orders: 0, consent: false, unsub: false, ...(guests.get(k) || {}), ...patch, lastSeen: now };
  guests.set(k, g);
  fs.appendFileSync(GUESTS_LOG, JSON.stringify(g) + '\n');
  return g;
}
const unsubToken = (r, email) => crypto.createHmac('sha256', 'foodol-unsub:' + OWNER_KEY).update(r === FIRST ? email : r + ':' + email).digest('hex').slice(0, 24);

/* ---------- code email through Resend (only when RESEND_API_KEY is set) ---------- */
async function sendCodeEmail(order, rest) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !order.email) return;
  const name = rest.name;
  const unsub = `${APP_URL}/unsubscribe?r=${rest.slug}&e=${encodeURIComponent(order.email)}&t=${unsubToken(rest.slug, order.email)}`;
  const rows = order.items.map((i) => `<tr><td style="padding:8px 0;color:#123a22">${i.q}× ${escH(i.n)}</td><td style="padding:8px 0;text-align:right;color:#123a22">$${(i.p * i.q).toFixed(2)}</td></tr>`).join('')
    + (order.extra ? `<tr><td style="padding:8px 0;color:#259a52;font-weight:700">1× ${escH(order.extra)}</td><td style="padding:8px 0;text-align:right;color:#259a52;font-weight:700">FREE</td></tr>` : '');
  const html = `<!doctype html><html><body style="margin:0;background:#f6f8f6;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8f6;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:22px;padding:28px">
<tr><td align="center"><img src="https://d2ol7oe51mr4n9.cloudfront.net/user_3GsbRE1t9hIx7tjNcLo5jEaZ8ao/ee71f398-e40a-43c4-bd33-bd2c1871094c.png" width="104" height="104" alt="Foodol" style="display:block;border:0"></td></tr>
<tr><td align="center" style="font-size:22px;font-weight:800;color:#123a22;padding-top:8px">${order.paid ? 'Your order is in!' : 'Show this at the counter'}</td></tr>
<tr><td align="center" style="font-size:15px;color:#4c6656;padding-top:4px">${escH(name)}</td></tr>
<tr><td align="center" style="font-size:52px;font-weight:800;color:#123a22;letter-spacing:-1px;padding:14px 0 4px">#${escH(order.code)}</td></tr>
<tr><td align="center" style="font-size:15px;font-weight:700;color:#123a22;padding-bottom:14px">${escH(order.title)}</td></tr>
<tr><td><table role="presentation" width="100%" style="border-top:1px dashed #d6e0da;border-bottom:1px dashed #d6e0da;font-size:15px">${rows}</table></td></tr>
<tr><td style="padding-top:12px;font-size:17px;font-weight:800;color:#123a22;text-align:right">${order.paid ? `Paid $${(order.charged || order.total).toFixed(2)} <span style="font-weight:500;font-size:13px;color:#7d8f84">incl. tax</span>` : `Total $${order.total.toFixed(2)}`}</td></tr>
${order.extra ? `<tr><td align="center" style="padding-top:18px"><span style="display:inline-block;background:#fff6e4;color:#b55d10;font-weight:700;border-radius:999px;padding:8px 16px;font-size:14px">Your free ${escH(order.extra)} is included</span></td></tr>` : ''}
<tr><td align="center" style="font-size:13px;color:#7d8f84;padding-top:20px">${order.paid ? `Pick it up at the counter in about 20 minutes. Give the name ${escH(order.pickupName || '')}.${order.receiptUrl ? ` <a href="${escH(order.receiptUrl)}" style="color:#259a52">Receipt</a>` : ''}` : 'The cashier rings up your order and marks the code as used.'}</td></tr>
</table>
<p style="font-size:12px;color:#7d8f84;max-width:440px;margin:16px auto 0;text-align:center">You got this because you redeemed a Foodol code at ${escH(name)}. <a href="${unsub}" style="color:#7d8f84">Unsubscribe</a> · <a href="${APP_URL}/privacy" style="color:#7d8f84">Privacy</a></p>
</td></tr></table></body></html>`;
  const text = `Show this at the counter at ${name}.\nYour Foodol code: #${order.code} (${order.title})\n` + order.items.map((i) => `${i.q}x ${i.n}  $${(i.p * i.q).toFixed(2)}`).join('\n') + (order.extra ? `\n1x ${order.extra}  FREE` : '') + `\nTotal $${order.total.toFixed(2)}\n\nUnsubscribe: ${unsub}`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.FROM_EMAIL || 'Foodol <codes@foodol.app>', to: [order.email], subject: `Your order code for ${name}: #${order.code}`, html, text, headers: { 'List-Unsubscribe': `<${unsub}>` } }),
    });
    if (!r.ok) console.error('resend failed', r.status, (await r.text()).slice(0, 300));
  } catch (e) { console.error('resend error', e.message); }
}

/* ---------- http helpers ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function redirect(res, to) { res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); }
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 300000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
function simplePage(title, body) {
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>${escH(title)}</title><style>body{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:620px;margin:40px auto;padding:0 22px;color:#123a22;line-height:1.55}h1{font-size:26px}a{color:#259a52}</style><img src="https://d2ol7oe51mr4n9.cloudfront.net/user_3GsbRE1t9hIx7tjNcLo5jEaZ8ao/fe5e036c-785b-4e97-b270-c3a52036389d.svg" height="70" alt=""><h1>${escH(title)}</h1>${body}`;
}
const file = (name) => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

/* ---------- who is calling ---------- */
const isAdmin = (req) => readToken(cookies(req).fd_admin, 'admin') === 'admin';
// Restaurant the caller may manage: the owner's own, or any (?r=) for the Foodol admin.
function portalRest(req, url) {
  if (isAdmin(req) && url.searchParams.get('r')) return findR(url.searchParams.get('r'));
  const sub = readToken(cookies(req).fd_rest, 'rest');
  if (!sub) return null;
  const [slug, ver] = sub.split(':');
  const r = findR(slug);
  return r && r.owner && String(r.owner.ver || 0) === ver ? r : null;
}

function stats(r) {
  const os = [...orders.values()].filter((o) => o.r === r.slug);
  const red = os.filter((o) => o.redeemedAt);
  const sales = red.reduce((t, o) => t + (o.total || 0), 0);
  const gs = [...guests.values()].filter((g) => g.r === r.slug);
  const last = os.reduce((m, o) => (o.createdAt > m ? o.createdAt : m), '');
  return { orders: os.length, redeemed: red.length, sales: Math.round(sales * 100) / 100, guests: gs.length, freeGiven: red.filter((o) => o.extra).length, lastOrder: last || null };
}
const publicRest = (r) => ({ slug: r.slug, name: r.name, createdAt: r.createdAt, owner: r.owner ? { email: r.owner.email } : null, stats: stats(r), items: r.menu.items.length,
  square: r.square ? { env: r.square.env, locationId: r.square.locationId, locationName: r.square.locationName || '', appId: r.square.appId, linked: r.menu.items.filter((i) => i.sq).length } : null });

/* ---------- Square: online ordering straight into the restaurant's POS ---------- */
// Each restaurant's access token stays on the server; the browser only gets the public app id + location.
const SQ_VERSION = '2026-09-16';
class SqError extends Error { constructor(msg, status, codes) { super(msg); this.status = status; this.codes = codes || []; } }
async function sq(rest, pathname, init = {}) {
  const c = rest.square;
  if (!c || !c.token) throw new SqError('Square is not connected for this restaurant', 503);
  const base = process.env.SQUARE_TEST_BASE || (c.env === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com');
  const r = await fetch(base + pathname, { ...init, headers: { 'Square-Version': SQ_VERSION, Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('[square]', rest.slug, pathname, r.status, JSON.stringify(body.errors || '').slice(0, 400));
    throw new SqError((body.errors && body.errors[0] && body.errors[0].detail) || 'Square request failed', r.status, (body.errors || []).map((e) => e.code));
  }
  return body;
}
async function sqCatalog(rest) {
  const objects = []; let cursor;
  do {
    const page = await sq(rest, `/v2/catalog/list?types=ITEM,CATEGORY,TAX${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    objects.push(...(page.objects || [])); cursor = page.cursor;
  } while (cursor);
  return objects.filter((o) => !o.is_deleted);
}
const sqTaxCache = new Map();
async function sqTaxIds(rest) {
  const hit = sqTaxCache.get(rest.slug);
  if (hit && Date.now() - hit.at < 10 * 60e3) return hit.ids;
  const ids = (await sqCatalog(rest)).filter((o) => o.type === 'TAX' && (!o.present_at_location_ids || o.present_at_all_locations !== false || o.present_at_location_ids.includes(rest.square.locationId))).map((o) => o.id);
  sqTaxCache.set(rest.slug, { at: Date.now(), ids });
  return ids;
}
const DRINK_RE = /drink|beverage|coffee|espresso|latte|tea\b|teas\b|boba|smoothie|juice|soda|lemonade|frapp|shake/i;
const SIDE_RE = /side|extra|add[- ]?on|topping|dessert|snack|appetizer|starter/i;
// Turn the Square catalog into a Foodol menu (first priced variation of each item).
function menuFromCatalog(objects, keep) {
  const cats = new Map(objects.filter((o) => o.type === 'CATEGORY').map((o) => [o.id, (o.category_data && o.category_data.name) || '']));
  const prev = new Map((keep.items || []).filter((i) => i.sq).map((i) => [i.sq, i]));
  const items = [];
  for (const o of objects) {
    const d = o.item_data; if (o.type !== 'ITEM' || !d || d.is_archived) continue;
    const v = (d.variations || []).find((x) => x.item_variation_data && x.item_variation_data.price_money);
    if (!v) continue;
    const catId = (d.categories && d.categories[0] && d.categories[0].id) || d.category_id || (d.reporting_category && d.reporting_category.id);
    const sname = cats.get(catId) || 'Menu';
    const old = prev.get(v.id);
    const k = old ? old.k : DRINK_RE.test(sname + ' ' + d.name) ? 'drink' : SIDE_RE.test(sname) ? 'side' : 'main';
    items.push({ id: v.id.slice(0, 24), sq: v.id, s: sname, n: d.name, d: (d.description_plaintext || d.description || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      p: v.item_variation_data.price_money.amount / 100, c: old ? old.c : [slugify(sname).slice(0, 20)], k, pop: old ? old.pop : 3, on: old ? old.on : true });
  }
  // cravings: one per food category (up to 6), unless the restaurant already set its own
  let cravings = keep.cravings;
  if (!cravings) {
    const counts = new Map();
    items.filter((i) => i.k !== 'drink').forEach((i) => counts.set(i.s, (counts.get(i.s) || 0) + 1));
    cravings = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([sname]) => ({ id: slugify(sname).slice(0, 20), label: sname.slice(0, 24), emoji: '🍽️' }));
  }
  return cleanMenu({ free: keep.free || { on: true, name: 'Iced tea', min: 20, grace: 0.5 }, popular: keep.popular || [], cravings, items });
}
// Build the Square order for a Foodol cart. Prices always come from Square's catalog, never the browser.
async function sqOrderFor(rest, lines, extra) {
  const byId = new Map(rest.menu.items.map((i) => [i.id, i]));
  const picked = [];
  for (const l of Array.isArray(lines) ? lines.slice(0, 30) : []) {
    const it = byId.get(String(l.id)); const q = Math.min(20, Math.max(1, Math.round(+l.q || 1)));
    if (!it || it.on === false || !it.sq) throw new SqError(`“${it ? it.n : 'An item'}” can’t be ordered online right now.`, 409);
    picked.push({ it, q });
  }
  if (!picked.length) throw new SqError('Your order is empty.', 400);
  const taxIds = await sqTaxIds(rest);
  const order = {
    location_id: rest.square.locationId,
    line_items: picked.map(({ it, q }) => ({ catalog_object_id: it.sq, quantity: String(q) })),
    taxes: taxIds.map((id) => ({ uid: 'tax-' + id, catalog_object_id: id, scope: 'ORDER' })),
  };
  const calc = await sq(rest, '/v2/orders/calculate', { method: 'POST', body: JSON.stringify({ order }) });
  const total = calc.order.total_money.amount, tax = (calc.order.total_tax_money || {}).amount || 0;
  const subtotal = total - tax, free = rest.menu.free;
  const qualifies = !!(extra && free && free.on && subtotal / 100 >= free.min - (free.grace || 0));
  if (qualifies) order.line_items.push({ name: `FREE ${free.name} (Foodol)`, quantity: '1', base_price_money: { amount: 0, currency: 'USD' }, note: 'Free with a Foodol combo' });
  return { order, picked, subtotal, tax, total, qualifies };
}

/* ---------- server ---------- */
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  /* guest API */
  if (p === '/api/order' && req.method === 'POST') {
    const b = await readBody(req);
    const rest = findR(clean(b.r, 40)) || findR(FIRST);
    const items = Array.isArray(b.items) ? b.items.slice(0, 20).map((i) => ({ n: clean(i.n), q: Math.min(20, Math.max(1, +i.q || 1)), p: +i.p || 0 })) : [];
    if (!items.length) return send(res, 400, { error: 'no items' });
    const order = {
      id: crypto.randomBytes(9).toString('base64url'),
      r: rest.slug,
      code: newCode(rest.slug),
      kind: clean(b.kind, 20), title: clean(b.title, 40), party: Math.min(20, +b.party || 1),
      items, extra: clean(b.extra, 40),
      total: Math.round(items.reduce((t, i) => t + i.p * i.q, 0) * 100) / 100,
      src: clean(url.searchParams.get('src') || b.src, 20),
      email: cleanEmail(b.email),
      createdAt: new Date().toISOString(), redeemedAt: null,
    };
    orders.set(order.id, order); append({ type: 'order', order });
    if (order.email) {
      const prev = guests.get(rest.slug + ':' + order.email);
      upsertGuest(rest.slug, order.email, { orders: (prev ? prev.orders : 0) + 1, consent: !!b.consent || !!(prev && prev.consent), unsub: prev ? prev.unsub && !b.consent : false });
      sendCodeEmail(order, rest);
    }
    return send(res, 200, order);
  }
  const m = p.match(/^\/api\/order\/([\w-]+)(\/redeem)?$/);
  if (m) {
    const o = orders.get(m[1]);
    if (!o) return send(res, 404, { error: 'not found' });
    if (m[2] && req.method === 'POST') {
      if (o.redeemedAt) return send(res, 409, { error: 'already redeemed', order: o });
      o.redeemedAt = new Date().toISOString(); append({ type: 'redeem', id: o.id, at: o.redeemedAt });
      return send(res, 200, o);
    }
    return send(res, 200, o);
  }

  /* Square: price a cart, then pay and send it to the restaurant's POS */
  if (p === '/api/pay/quote' && req.method === 'POST') {
    const b = await readBody(req), rest = findR(clean(b.r, 40));
    if (!rest || !rest.square) return send(res, 404, { error: 'Online ordering isn’t set up here.' });
    try { const q = await sqOrderFor(rest, b.items, b.extra); return send(res, 200, { subtotal: q.subtotal, tax: q.tax, total: q.total, free: q.qualifies }); }
    catch (e) { return send(res, e.status && e.status < 500 ? e.status : 502, { error: e.message }); }
  }
  if (p === '/api/pay' && req.method === 'POST') {
    if (tooMany(req)) return send(res, 429, { error: 'Too many tries. Wait a few minutes.' });
    const b = await readBody(req), rest = findR(clean(b.r, 40));
    if (!rest || !rest.square) return send(res, 404, { error: 'Online ordering isn’t set up here.' });
    const name = clean(b.name, 60).trim(), phone = clean(b.phone, 30).replace(/[^\d+]/g, ''), email = cleanEmail(b.email);
    if (!name) return send(res, 400, { error: 'Add a name for the pickup order.' });
    if (phone.replace(/\D/g, '').length < 10) return send(res, 400, { error: 'Add a phone number so the restaurant can reach you.' });
    if (!b.sourceId) return send(res, 400, { error: 'Payment details are missing.' });
    const idem = clean(b.idem, 40).replace(/[^\w-]/g, '') || crypto.randomUUID();
    try {
      const q = await sqOrderFor(rest, b.items, b.extra);
      if (q.qualifies && !email) return send(res, 400, { error: 'Add your email to get the free item.' });
      const code = newCode(rest.slug);
      const { order: created } = await sq(rest, '/v2/orders', { method: 'POST', body: JSON.stringify({ idempotency_key: idem + '-order', order: { ...q.order, reference_id: 'foodol-' + code, source: { name: 'Foodol' },
        fulfillments: [{ type: 'PICKUP', state: 'PROPOSED', pickup_details: { schedule_type: 'ASAP', prep_time_duration: 'PT20M', note: `Foodol #${code}${q.qualifies ? ' · includes FREE ' + rest.menu.free.name : ''}`, recipient: { display_name: name, phone_number: phone, email_address: email || undefined } } }] } }) });
      const { payment } = await sq(rest, '/v2/payments', { method: 'POST', body: JSON.stringify({ idempotency_key: idem + '-pay', source_id: String(b.sourceId), verification_token: b.verificationToken || undefined,
        amount_money: created.total_money, order_id: created.id, location_id: rest.square.locationId, autocomplete: true, buyer_email_address: email || undefined, buyer_phone_number: phone, note: `Foodol pickup for ${name}` }) });
      const order = {
        id: crypto.randomBytes(9).toString('base64url'), r: rest.slug, code,
        kind: clean(b.kind, 20), title: clean(b.title, 40), party: Math.min(20, +b.party || 1),
        items: q.picked.map(({ it, q: n }) => ({ n: it.n, q: n, p: it.p })), extra: q.qualifies ? rest.menu.free.name : '',
        total: q.subtotal / 100, tax: q.tax / 100, charged: created.total_money.amount / 100,
        paid: true, pickupName: name, squareOrderId: created.id, paymentStatus: payment.status, receiptUrl: payment.receipt_url || null,
        src: clean(b.src, 20), email, createdAt: new Date().toISOString(), redeemedAt: new Date().toISOString(),
      };
      orders.set(order.id, order); append({ type: 'order', order });
      if (email) {
        const prev = guests.get(rest.slug + ':' + email);
        upsertGuest(rest.slug, email, { orders: (prev ? prev.orders : 0) + 1, consent: !!b.consent || !!(prev && prev.consent), unsub: prev ? prev.unsub && !b.consent : false });
        sendCodeEmail(order, rest);
      }
      return send(res, 200, order);
    } catch (e) {
      const declined = (e.codes || []).some((c) => /CARD|CVV|DECLINED|INSUFFICIENT|EXPIR|ADDRESS|POSTAL|VERIFY/.test(c));
      return send(res, e.status && e.status < 500 ? e.status : 502, { error: declined ? 'Your card was declined. Try another card.' : e.message });
    }
  }

  /* restaurant sign-ups from the landing page */
  if (p === '/api/lead' && req.method === 'POST') {
    if (tooMany(req)) return send(res, 429, { error: 'Too many tries. Wait a few minutes.' });
    const b = await readBody(req);
    if (b.website) return send(res, 200, { ok: true }); // bot trap
    const lead = { at: new Date().toISOString(), name: clean(b.name, 60).trim(), restaurant: clean(b.restaurant, 80).trim(), email: cleanEmail(b.email), phone: clean(b.phone, 30).trim(), city: clean(b.city, 60).trim() };
    if (!lead.name || !lead.restaurant) return send(res, 400, { error: 'Please add your name and restaurant.' });
    if (!lead.email) return send(res, 400, { error: 'That email doesn’t look right.' });
    fs.appendFileSync(LEADS_LOG, JSON.stringify(lead) + '\n');
    return send(res, 200, { ok: true });
  }

  /* Foodol admin (password only) */
  if (p === '/api/admin/login' && req.method === 'POST') {
    if (tooMany(req)) return send(res, 429, { error: 'Too many tries. Wait a few minutes.' });
    const b = await readBody(req);
    if (String(b.password || '') !== ADMIN_PASSWORD) return send(res, 401, { error: 'wrong password' });
    res.setHeader('Set-Cookie', cookieStr(req, 'fd_admin', makeToken('admin', 'admin', 30), 30 * 86400));
    return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/logout' && req.method === 'POST') { res.setHeader('Set-Cookie', cookieStr(req, 'fd_admin', '', 0)); return send(res, 200, { ok: true }); }
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'login needed' });
    if (p === '/api/admin/restaurants' && req.method === 'GET') {
      const leads = fs.existsSync(LEADS_LOG) ? fs.readFileSync(LEADS_LOG, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse() : [];
      return send(res, 200, { restaurants: restaurants.map(publicRest), leads, appUrl: APP_URL, emailOn: !!process.env.RESEND_API_KEY });
    }
    if (p === '/api/admin/restaurants' && req.method === 'POST') {
      const b = await readBody(req);
      const name = clean(b.name, 60).trim(), slug = slugify(b.slug || name);
      if (!name) return send(res, 400, { error: 'Give the restaurant a name.' });
      if (!validSlug(slug)) return send(res, 400, { error: 'That link name isn’t allowed. Use letters, numbers and dashes.' });
      if (findR(slug) || aliases[slug]) return send(res, 400, { error: `foodol.app/${slug} is already taken.` });
      const r = { slug, name, menu: { free: { on: true, name: 'Iced tea', min: 20, grace: 0.5 }, items: [] }, owner: null, createdAt: new Date().toISOString() };
      const em = cleanEmail(b.email);
      if (em && String(b.password || '').length >= 8) r.owner = { email: em, ...hashPassword(b.password), ver: 1 };
      restaurants.push(r); saveRestaurants();
      return send(res, 200, publicRest(r));
    }
    const lm = p.match(/^\/api\/admin\/restaurants\/([a-z0-9-]+)\/login$/);
    if (lm && req.method === 'POST') {
      const r = findR(lm[1]); if (!r) return send(res, 404, { error: 'not found' });
      const b = await readBody(req), em = cleanEmail(b.email);
      if (!em) return send(res, 400, { error: 'Enter a valid email.' });
      if (restaurants.some((x) => x !== r && x.owner && x.owner.email === em)) return send(res, 400, { error: 'That email already logs in to another restaurant.' });
      if (String(b.password || '').length < 8) return send(res, 400, { error: 'Password needs at least 8 characters.' });
      r.owner = { email: em, ...hashPassword(b.password), ver: ((r.owner && r.owner.ver) || 0) + 1 };
      saveRestaurants();
      return send(res, 200, publicRest(r));
    }
    // Connect a restaurant's Square account (access token stays on the server)
    const sqm = p.match(/^\/api\/admin\/restaurants\/([a-z0-9-]+)\/square(\/import)?$/);
    if (sqm) {
      const r = findR(sqm[1]); if (!r) return send(res, 404, { error: 'not found' });
      if (!sqm[2] && req.method === 'DELETE') { delete r.square; saveRestaurants(); return send(res, 200, publicRest(r)); }
      if (!sqm[2] && req.method === 'PUT') {
        const b = await readBody(req);
        const env = b.env === 'production' ? 'production' : 'sandbox';
        const next = { env, token: String(b.token || (r.square && r.square.token) || '').trim(), appId: String(b.appId || '').trim(), locationId: String(b.locationId || '').trim() };
        if (!next.token) return send(res, 400, { error: 'Paste the Square access token.' });
        if (!/^(sandbox-)?sq0idp-[\w-]+$|^sandbox-sq0idb-[\w-]+$/.test(next.appId)) return send(res, 400, { error: 'That application ID doesn’t look right. It starts with sq0idp- (or sandbox-sq0idb- for test mode).' });
        if (env === 'sandbox' !== next.appId.startsWith('sandbox-')) return send(res, 400, { error: 'Test mode needs the sandbox application ID, live mode needs the production one.' });
        try {
          const { locations = [] } = await sq({ slug: r.slug, square: next }, '/v2/locations');
          const active = locations.filter((l) => l.status === 'ACTIVE');
          const loc = active.find((l) => l.id === next.locationId) || active[0];
          if (!loc) return send(res, 400, { error: 'That Square account has no active locations.' });
          r.square = { ...next, locationId: loc.id, locationName: loc.name };
          sqTaxCache.delete(r.slug); saveRestaurants();
          return send(res, 200, { ...publicRest(r), locations: active.map((l) => ({ id: l.id, name: l.name })) });
        } catch (e) { return send(res, 400, { error: e.status === 401 ? 'Square didn’t accept that access token.' : e.message }); }
      }
      if (sqm[2] && req.method === 'POST') {
        if (!r.square) return send(res, 400, { error: 'Connect Square first.' });
        try {
          const menu = menuFromCatalog(await sqCatalog(r), r.menu);
          if (!menu.items.length) return send(res, 400, { error: 'No priced items found in the Square catalog.' });
          r.menu = menu; saveRestaurants();
          return send(res, 200, publicRest(r));
        } catch (e) { return send(res, 502, { error: e.message }); }
      }
    }
    // Start a restaurant over at zero: clears its orders and guest emails (menu and login stay).
    const wp = p.match(/^\/api\/admin\/restaurants\/([a-z0-9-]+)\/reset$/);
    if (wp && req.method === 'POST') {
      const r = findR(wp[1]); if (!r) return send(res, 404, { error: 'not found' });
      const at = new Date().toISOString();
      append({ type: 'wipe', r: r.slug, at });
      for (const [id, o] of orders) if (o.r === r.slug) orders.delete(id);
      fs.appendFileSync(GUESTS_LOG, JSON.stringify({ wipe: r.slug, at }) + '\n');
      for (const [k, g] of guests) if (g.r === r.slug) guests.delete(k);
      return send(res, 200, publicRest(r));
    }
    // Merge one restaurant into another: its menu (if the other has none), orders and guests move over,
    // the old one is removed, and its link forwards to the new one.
    const mg = p.match(/^\/api\/admin\/restaurants\/([a-z0-9-]+)\/merge$/);
    if (mg && req.method === 'POST') {
      const from = restaurants.find((r) => r.slug === mg[1]), b = await readBody(req), to = restaurants.find((r) => r.slug === String(b.into || ''));
      if (!from || !to || from === to) return send(res, 400, { error: 'Pick two different restaurants.' });
      if (!to.menu.items.length || b.menu === 'replace') to.menu = JSON.parse(JSON.stringify(from.menu));
      if (!to.owner && from.owner) to.owner = from.owner;
      let moved = 0;
      for (const o of orders.values()) if (o.r === from.slug) { o.r = to.slug; moved++; }
      for (const [k, g] of [...guests]) if (g.r === from.slug) {
        guests.delete(k); const nk = to.slug + ':' + g.email, prev = guests.get(nk);
        guests.set(nk, prev ? { ...g, ...prev, r: to.slug, orders: (prev.orders || 0) + (g.orders || 0) } : { ...g, r: to.slug });
      }
      for (const a of Object.keys(aliases)) if (aliases[a] === from.slug) aliases[a] = to.slug;
      aliases[from.slug] = to.slug;
      writeJSON(ALIAS_FILE, aliases);
      restaurants = restaurants.filter((r) => r !== from); saveRestaurants();
      return send(res, 200, { ok: true, into: publicRest(to), ordersMoved: moved });
    }
    const nm = p.match(/^\/api\/admin\/restaurants\/([a-z0-9-]+)$/);
    if (nm && req.method === 'PATCH') {
      const r = findR(nm[1]); if (!r) return send(res, 404, { error: 'not found' });
      const b = await readBody(req); const name = clean(b.name, 60).trim();
      if (name) r.name = name;
      saveRestaurants();
      return send(res, 200, publicRest(r));
    }
    return send(res, 404, { error: 'not found' });
  }

  /* restaurant portal (email + password) */
  if (p === '/api/portal/login' && req.method === 'POST') {
    if (tooMany(req)) return send(res, 429, { error: 'Too many tries. Wait a few minutes.' });
    const b = await readBody(req), em = cleanEmail(b.email);
    const r = restaurants.find((x) => x.owner && x.owner.email === em);
    if (!r || !checkPassword(b.password, r.owner)) return send(res, 401, { error: 'That email and password don’t match.' });
    res.setHeader('Set-Cookie', cookieStr(req, 'fd_rest', makeToken('rest', `${r.slug}:${r.owner.ver || 0}`, 30), 30 * 86400));
    return send(res, 200, { ok: true, slug: r.slug });
  }
  if (p === '/api/portal/logout' && req.method === 'POST') { res.setHeader('Set-Cookie', cookieStr(req, 'fd_rest', '', 0)); return send(res, 200, { ok: true }); }
  if (p.startsWith('/api/portal/')) {
    const r = portalRest(req, url);
    if (!r) return send(res, 401, { error: 'login needed' });
    if (p === '/api/portal/data') {
      const all = [...orders.values()].filter((o) => o.r === r.slug).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const gl = [...guests.values()].filter((g) => g.r === r.slug).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
      return send(res, 200, { restaurant: { slug: r.slug, name: r.name, email: r.owner ? r.owner.email : null }, menu: { restaurant: r.name, ...r.menu }, orders: all.slice(0, 200), totalOrders: all.length, guests: gl, emailOn: !!process.env.RESEND_API_KEY, asAdmin: isAdmin(req) && !!url.searchParams.get('r'), appUrl: APP_URL });
    }
    if (p === '/api/portal/menu' && req.method === 'PUT') {
      const mn = cleanMenu(await readBody(req));
      if (!mn.items.length) return send(res, 400, { error: 'menu is empty' });
      r.menu = mn; saveRestaurants();
      return send(res, 200, { restaurant: r.name, ...r.menu });
    }
    if (p === '/api/portal/password' && req.method === 'POST') {
      if (!r.owner) return send(res, 400, { error: 'No login set for this restaurant.' });
      const b = await readBody(req);
      if (!checkPassword(b.current, r.owner)) return send(res, 400, { error: 'Your current password isn’t right.' });
      if (String(b.next || '').length < 8) return send(res, 400, { error: 'New password needs at least 8 characters.' });
      r.owner = { ...r.owner, ...hashPassword(b.next), ver: (r.owner.ver || 0) + 1 };
      saveRestaurants();
      res.setHeader('Set-Cookie', cookieStr(req, 'fd_rest', makeToken('rest', `${r.slug}:${r.owner.ver}`, 30), 30 * 86400));
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'not found' });
  }

  /* pages */
  if (p === '/admin') return send(res, 200, file('admin.html'), MIME['.html']);
  if (p === '/portal') return send(res, 200, file('portal.html'), MIME['.html']);
  if (p === '/owner') return redirect(res, '/portal');
  if (p === '/unsubscribe') {
    const raw = url.searchParams.get('r') || FIRST, r = go(raw);
    const em = cleanEmail(url.searchParams.get('e'));
    const ok = em && (url.searchParams.get('t') === unsubToken(raw, em) || url.searchParams.get('t') === unsubToken(r, em));
    if (ok && guests.has(r + ':' + em)) upsertGuest(r, em, { consent: false, unsub: true });
    return send(res, ok ? 200 : 400, simplePage(ok ? 'You’re unsubscribed' : 'Link not valid', ok ? `<p>${escH(em)} won’t get Foodol deals anymore. You’ll still get a copy of any code you redeem yourself.</p>` : '<p>This unsubscribe link looks broken. Reply to any Foodol email and we’ll remove you.</p>'), 'text/html; charset=utf-8');
  }
  if (p === '/privacy') {
    return send(res, 200, simplePage('Foodol privacy', `<p>Foodol helps you pick an order at participating restaurants. Here’s what we collect and why.</p>
<p><b>What we collect.</b> When you redeem a code, the items in your order, your order total, and the email address you give us. We don’t collect payment details; you pay the restaurant directly.</p>
<p><b>How we use it.</b> To send you a copy of your code, to show the restaurant which orders came through Foodol, and, if you agree, to send occasional Foodol and restaurant deals.</p>
<p><b>Who sees it.</b> Foodol and the restaurant where you redeemed. We don’t sell your information.</p>
<p><b>Your choices.</b> Every email has an unsubscribe link. To see or delete your information, email us and we’ll take care of it.</p>
<p>California residents: you can ask what personal information we hold about you and ask us to delete it. We don’t sell or share personal information for cross-context advertising.</p>`), 'text/html; charset=utf-8');
  }

  // The root is the Foodol landing page. Old QR codes (/?src=poster|sticker) still go to Sausalido.
  if (p === '/' || p === '/index.html') {
    if (url.searchParams.has('src') || p === '/index.html') return redirect(res, '/' + go(FIRST) + url.search);
    return send(res, 200, file('home.html'), MIME['.html']);
  }

  // Guest app for a restaurant: foodol.app/<slug>. Old link names forward to the new one.
  if (/^\/[a-z0-9-]+$/.test(p) && aliases[p.slice(1)]) return redirect(res, '/' + go(p.slice(1)) + url.search);
  const rest = /^\/[a-z0-9-]+$/.test(p) ? findR(p.slice(1)) : null;
  if (rest) {
    const live = { restaurant: { slug: rest.slug, name: rest.name }, free: rest.menu.free, popular: rest.menu.popular, cravings: cravingsOf(rest.menu),
      pay: rest.square && rest.square.appId ? { provider: 'square', appId: rest.square.appId, locationId: rest.square.locationId, sandbox: rest.square.env !== 'production' } : null, items: rest.menu.items.filter((i) => i.on !== false && i.p > 0) };
    if (live.items.filter((i) => i.k !== 'drink').length < 2) return send(res, 200, simplePage(`Foodol is coming to ${rest.name}`, '<p>Foodol is setting up the menu here. Check back soon!</p>'), MIME['.html']);
    const html = file('index.html').replace('<!--FOODOL_MENU-->', '<script>window.FOODOL_MENU=' + JSON.stringify(live).replace(/</g, '\\u003c') + ';</script>');
    return send(res, 200, html, MIME['.html']);
  }

  // static files
  const f = path.normalize(path.join(PUBLIC, p));
  if (!f.startsWith(PUBLIC + path.sep) || /\/(index|admin|portal|home)\.html$/.test(f)) return send(res, 404, simplePage('Not found', '<p>That page doesn’t exist. <a href="/">Go to Foodol</a></p>'), 'text/html; charset=utf-8');
  fs.readFile(f, (err, data) => {
    if (err) return send(res, 404, simplePage('Not found', '<p>That page doesn’t exist. <a href="/">Go to Foodol</a></p>'), 'text/html; charset=utf-8');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => console.log('Foodol listening on', PORT));
