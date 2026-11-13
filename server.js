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
const REST_FILE = path.join(DATA_DIR, 'restaurants.json');
const FIRST = 'sausalido'; // the original restaurant; old data and old QR codes belong to it

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
const CRAVES = ['breakfast', 'thai', 'sandwich', 'sweet'];
function cleanMenu(b) {
  const f = b.free || {};
  const seen = new Set();
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 300).map((i, n) => {
    let id = String(i.id || '').replace(/[^\w-]/g, '').slice(0, 24) || 'i' + n;
    while (seen.has(id)) id += 'x';
    seen.add(id);
    return {
      id, s: clean(i.s, 40) || 'Menu', n: clean(i.n, 60), d: clean(i.d, 140), p: num(i.p, 0, 500),
      c: (Array.isArray(i.c) ? i.c : []).filter((c) => CRAVES.includes(c)),
      k: ['main', 'side', 'drink'].includes(i.k) ? i.k : 'main', pop: Math.min(5, Math.max(1, Math.round(+i.pop || 3))), on: i.on !== false,
    };
  }).filter((i) => i.n);
  return { free: { on: !!f.on, name: clean(f.name, 40) || 'free item', min: num(f.min, 0, 500), grace: num(f.grace ?? 0.5, 0, 5) }, items };
}

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
const findR = (slug) => restaurants.find((r) => r.slug === slug);

/* ---------- orders ---------- */
const orders = new Map();
if (fs.existsSync(LOG)) {
  for (const line of fs.readFileSync(LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'order') orders.set(ev.order.id, { r: FIRST, ...ev.order });
      if (ev.type === 'redeem' && orders.has(ev.id)) orders.get(ev.id).redeemedAt = ev.at;
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
    try { const g = { r: FIRST, ...JSON.parse(line) }; const k = g.r + ':' + g.email; guests.set(k, { ...(guests.get(k) || {}), ...g }); } catch { /* skip */ }
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
<tr><td align="center"><img src="https://d2ol7oe51mr4n9.cloudfront.net/user_3GsbRE1t9hIx7tjNcLo5jEaZ8ao/fb01c05e-949a-4e50-86de-253056e50ede.webp" width="110" alt="Foodol" style="display:block"></td></tr>
<tr><td align="center" style="font-size:22px;font-weight:800;color:#123a22;padding-top:8px">Show this at the counter</td></tr>
<tr><td align="center" style="font-size:15px;color:#4c6656;padding-top:4px">${escH(name)}</td></tr>
<tr><td align="center" style="font-size:52px;font-weight:800;color:#123a22;letter-spacing:-1px;padding:14px 0 4px">#${escH(order.code)}</td></tr>
<tr><td align="center" style="font-size:15px;font-weight:700;color:#123a22;padding-bottom:14px">${escH(order.title)}</td></tr>
<tr><td><table role="presentation" width="100%" style="border-top:1px dashed #d6e0da;border-bottom:1px dashed #d6e0da;font-size:15px">${rows}</table></td></tr>
<tr><td style="padding-top:12px;font-size:17px;font-weight:800;color:#123a22;text-align:right">Total $${order.total.toFixed(2)}</td></tr>
${order.extra ? `<tr><td align="center" style="padding-top:18px"><span style="display:inline-block;background:#fff6e4;color:#b55d10;font-weight:700;border-radius:999px;padding:8px 16px;font-size:14px">Your free ${escH(order.extra)} is included</span></td></tr>` : ''}
<tr><td align="center" style="font-size:13px;color:#7d8f84;padding-top:20px">The cashier rings up your order and marks the code as used.</td></tr>
</table>
<p style="font-size:12px;color:#7d8f84;max-width:440px;margin:16px auto 0;text-align:center">You got this because you redeemed a Foodol code at ${escH(name)}. <a href="${unsub}" style="color:#7d8f84">Unsubscribe</a> · <a href="${APP_URL}/privacy" style="color:#7d8f84">Privacy</a></p>
</td></tr></table></body></html>`;
  const text = `Show this at the counter at ${name}.\nYour Foodol code: #${order.code} (${order.title})\n` + order.items.map((i) => `${i.q}x ${i.n}  $${(i.p * i.q).toFixed(2)}`).join('\n') + (order.extra ? `\n1x ${order.extra}  FREE` : '') + `\nTotal $${order.total.toFixed(2)}\n\nUnsubscribe: ${unsub}`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.FROM_EMAIL || 'Foodol <codes@foodol.app>', to: [order.email], subject: `Your Foodol code #${order.code}${order.extra ? ' + free ' + order.extra : ''}`, html, text, headers: { 'List-Unsubscribe': `<${unsub}>` } }),
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
const publicRest = (r) => ({ slug: r.slug, name: r.name, createdAt: r.createdAt, owner: r.owner ? { email: r.owner.email } : null, stats: stats(r), items: r.menu.items.length });

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
    if (p === '/api/admin/restaurants' && req.method === 'GET') return send(res, 200, { restaurants: restaurants.map(publicRest), appUrl: APP_URL, emailOn: !!process.env.RESEND_API_KEY });
    if (p === '/api/admin/restaurants' && req.method === 'POST') {
      const b = await readBody(req);
      const name = clean(b.name, 60).trim(), slug = slugify(b.slug || name);
      if (!name) return send(res, 400, { error: 'Give the restaurant a name.' });
      if (!validSlug(slug)) return send(res, 400, { error: 'That link name isn’t allowed. Use letters, numbers and dashes.' });
      if (findR(slug)) return send(res, 400, { error: `foodol.app/${slug} is already taken.` });
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
    const r = findR(url.searchParams.get('r')) ? url.searchParams.get('r') : FIRST;
    const em = cleanEmail(url.searchParams.get('e'));
    const ok = em && url.searchParams.get('t') === unsubToken(r, em);
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

  // The root: old QR codes (and the bare domain for now) go to Sausalido.
  if (p === '/' || p === '/index.html') {
    if (fs.existsSync(path.join(PUBLIC, 'home.html')) && !url.search) return send(res, 200, file('home.html'), MIME['.html']);
    return redirect(res, '/' + FIRST + url.search);
  }

  // Guest app for a restaurant: foodol.app/<slug>
  const rest = /^\/[a-z0-9-]+$/.test(p) ? findR(p.slice(1)) : null;
  if (rest) {
    const live = { restaurant: { slug: rest.slug, name: rest.name }, free: rest.menu.free, items: rest.menu.items.filter((i) => i.on !== false && i.p > 0) };
    if (live.items.filter((i) => i.k !== 'drink').length < 2) return send(res, 200, simplePage(`Foodol is coming to ${rest.name}`, '<p>Foodol is setting up the menu here. Check back soon!</p>'), MIME['.html']);
    const html = file('index.html').replace('<!--FOODOL_MENU-->', '<script>window.FOODOL_MENU=' + JSON.stringify(live).replace(/</g, '\\u003c') + ';</script>');
    return send(res, 200, html, MIME['.html']);
  }

  // static files
  const f = path.normalize(path.join(PUBLIC, p));
  if (!f.startsWith(PUBLIC + path.sep) || /\/(index|admin|portal)\.html$/.test(f)) return send(res, 404, simplePage('Not found', '<p>That page doesn’t exist. <a href="/">Go to Foodol</a></p>'), 'text/html; charset=utf-8');
  fs.readFile(f, (err, data) => {
    if (err) return send(res, 404, simplePage('Not found', '<p>That page doesn’t exist. <a href="/">Go to Foodol</a></p>'), 'text/html; charset=utf-8');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => console.log('Foodol listening on', PORT));
