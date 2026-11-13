// Foodol: tiny server for the static app + one-time combo codes.
// No dependencies. Orders are appended to a JSON-lines file in DATA_DIR
// (a Railway volume in production) so redemptions survive restarts.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const OWNER_KEY = process.env.OWNER_KEY || 'dev';
const PUBLIC = path.join(__dirname, 'public');
const LOG = path.join(DATA_DIR, 'orders.jsonl');

fs.mkdirSync(DATA_DIR, { recursive: true });

// In-memory state rebuilt from the log on boot.
const orders = new Map();
if (fs.existsSync(LOG)) {
  for (const line of fs.readFileSync(LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'order') orders.set(ev.order.id, ev.order);
      if (ev.type === 'redeem' && orders.has(ev.id)) orders.get(ev.id).redeemedAt = ev.at;
    } catch { /* skip bad line */ }
  }
}
const append = (ev) => fs.appendFileSync(LOG, JSON.stringify(ev) + '\n');

// Menu + free item: stored on the volume, seeded from menu.default.json.
const MENU_FILE = path.join(DATA_DIR, 'menu.json');
let menu = JSON.parse(fs.readFileSync(path.join(__dirname, 'menu.default.json'), 'utf8'));
try { if (fs.existsSync(MENU_FILE)) menu = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8')); } catch { /* keep default */ }
function saveMenu(m) {
  const tmp = MENU_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(m, null, 1));
  fs.renameSync(tmp, MENU_FILE);
  menu = m;
}
const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round((+v || 0) * 100) / 100));
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
  return {
    restaurant: clean(b.restaurant, 60) || menu.restaurant,
    free: { on: !!f.on, name: clean(f.name, 40) || 'free item', min: num(f.min, 0, 500), grace: num(f.grace ?? 0.5, 0, 5) },
    items,
  };
}

// Admin login: a cookie holding a hash of OWNER_KEY.
const ADMIN_TOKEN = crypto.createHash('sha256').update('foodol-admin:' + OWNER_KEY).digest('hex');
const isAdmin = (req) => (req.headers.cookie || '').split(/;\s*/).includes('fd_admin=' + ADMIN_TOKEN);

function newCode() {
  for (;;) {
    const c = String(crypto.randomInt(1000, 10000));
    if (![...orders.values()].some((o) => o.code === c && !o.redeemedAt)) return c;
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 300000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

const clean = (s, n = 80) => String(s ?? '').slice(0, n);

function ownerPage() {
  const all = [...orders.values()];
  const red = all.filter((o) => o.redeemedAt);
  const sum = (a) => a.reduce((t, o) => t + (o.total || 0), 0);
  const byKind = {};
  for (const o of red) byKind[o.kind] = (byKind[o.kind] || 0) + 1;
  const avg = red.length ? sum(red) / red.length : 0;
  const rows = red.slice(-50).reverse().map((o) =>
    `<tr><td>#${o.code}</td><td>${o.title}</td><td>${o.party}</td><td>$${o.total.toFixed(2)}</td><td>${new Date(o.redeemedAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}</td></tr>`).join('');
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Foodol · Owner stats</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 20px;color:#123a22}h1{font-size:24px}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}.c{background:#eef8f1;border-radius:14px;padding:16px}.c b{display:block;font-size:28px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px;border-bottom:1px solid #e3ece6}</style>
<h1>Foodol at Sausalido Cafe</h1><p>Every combo a cashier marked as redeemed.</p>
<div class=g><div class=c><b>${all.length}</b>combos picked</div><div class=c><b>${red.length}</b>redeemed</div><div class=c><b>$${sum(red).toFixed(2)}</b>Foodol sales</div><div class=c><b>$${avg.toFixed(2)}</b>average order</div></div>
<p>${Object.entries(byKind).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'No redemptions yet.'}</p>
<table><tr><th>Code</th><th>Combo</th><th>People</th><th>Total</th><th>Redeemed</th></tr>${rows}</table>`;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/api/order' && req.method === 'POST') {
    const b = await readBody(req);
    const items = Array.isArray(b.items) ? b.items.slice(0, 20).map((i) => ({ n: clean(i.n), q: Math.min(20, Math.max(1, +i.q || 1)), p: +i.p || 0 })) : [];
    if (!items.length) return send(res, 400, { error: 'no items' });
    const order = {
      id: crypto.randomBytes(9).toString('base64url'),
      code: newCode(),
      kind: clean(b.kind, 20), title: clean(b.title, 40), party: Math.min(20, +b.party || 1),
      items, extra: clean(b.extra, 40),
      total: Math.round(items.reduce((t, i) => t + i.p * i.q, 0) * 100) / 100,
      src: clean(url.searchParams.get('src') || b.src, 20),
      createdAt: new Date().toISOString(), redeemedAt: null,
    };
    orders.set(order.id, order); append({ type: 'order', order });
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

  if (p === '/api/menu') return send(res, 200, menu);

  if (p === '/api/admin/login' && req.method === 'POST') {
    const b = await readBody(req);
    if (String(b.key || '') !== OWNER_KEY) return send(res, 401, { error: 'wrong key' });
    res.setHeader('Set-Cookie', `fd_admin=${ADMIN_TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', 'fd_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return send(res, 200, { ok: true });
  }
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'login needed' });
    if (p === '/api/admin/data') {
      const all = [...orders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return send(res, 200, { menu, orders: all.slice(0, 200), totalOrders: all.length });
    }
    if (p === '/api/admin/menu' && req.method === 'PUT') {
      const m = cleanMenu(await readBody(req));
      if (!m.items.length) return send(res, 400, { error: 'menu is empty' });
      saveMenu(m);
      return send(res, 200, menu);
    }
    return send(res, 404, { error: 'not found' });
  }

  if (p === '/admin') {
    return fs.readFile(path.join(PUBLIC, 'admin.html'), 'utf8', (e, d) => (e ? send(res, 404, 'Not found', 'text/plain') : send(res, 200, d, MIME['.html'])));
  }

  if (p === '/owner') {
    if (url.searchParams.get('key') !== OWNER_KEY) return send(res, 403, 'Not allowed', 'text/plain');
    return send(res, 200, ownerPage(), 'text/html; charset=utf-8');
  }

  // static files; the app page gets the live menu baked in
  const appPage = () => fs.readFile(path.join(PUBLIC, 'index.html'), 'utf8', (e, html) => {
    if (e) return send(res, 404, 'Not found', 'text/plain');
    const live = { ...menu, items: menu.items.filter((i) => i.on !== false && i.p > 0) };
    send(res, 200, html.replace('<!--FOODOL_MENU-->', '<script>window.FOODOL_MENU=' + JSON.stringify(live).replace(/</g, '\\u003c') + ';</script>'), MIME['.html']);
  });
  if (p === '/' || p === '/index.html') return appPage();
  let file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'no', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return appPage();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', () => console.log('Foodol listening on', PORT));
