// Foodol on Cloudflare Workers.
// Static app is served from ./public (Workers static assets).
// Orders live in one SQLite-backed Durable Object ("store"), so every
// request sees the same data and one-time codes stay unique.
import { DurableObject } from 'cloudflare:workers';

const clean = (s, n = 80) => String(s ?? '').slice(0, n);
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export class Store extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS orders(
      id TEXT PRIMARY KEY, code TEXT, data TEXT NOT NULL,
      created_at TEXT NOT NULL, redeemed_at TEXT)`);
  }

  row(r) { const o = JSON.parse(r.data); o.redeemedAt = r.redeemed_at || null; return o; }

  get(id) {
    const r = this.sql.exec('SELECT * FROM orders WHERE id = ?', id).toArray()[0];
    return r ? this.row(r) : null;
  }

  create(b, src) {
    const items = Array.isArray(b.items)
      ? b.items.slice(0, 20).map((i) => ({ n: clean(i.n), q: Math.min(20, Math.max(1, +i.q || 1)), p: +i.p || 0 }))
      : [];
    if (!items.length) return { error: 'no items' };
    let code;
    do { code = String(1000 + Math.floor(Math.random() * 9000)); }
    while (this.sql.exec('SELECT 1 FROM orders WHERE code = ? AND redeemed_at IS NULL', code).toArray().length);
    const id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(9)))).replace(/\+/g, '-').replace(/\//g, '_');
    const order = {
      id, code,
      kind: clean(b.kind, 20), title: clean(b.title, 40), party: Math.min(20, +b.party || 1),
      items, extra: clean(b.extra, 40),
      total: Math.round(items.reduce((t, i) => t + i.p * i.q, 0) * 100) / 100,
      src: clean(src || b.src, 20),
      createdAt: new Date().toISOString(), redeemedAt: null,
    };
    this.sql.exec('INSERT INTO orders(id, code, data, created_at) VALUES (?,?,?,?)', id, code, JSON.stringify(order), order.createdAt);
    return order;
  }

  redeem(id) {
    const o = this.get(id);
    if (!o) return { status: 404, body: { error: 'not found' } };
    if (o.redeemedAt) return { status: 409, body: { error: 'already redeemed', order: o } };
    o.redeemedAt = new Date().toISOString();
    this.sql.exec('UPDATE orders SET redeemed_at = ? WHERE id = ?', o.redeemedAt, id);
    return { status: 200, body: o };
  }

  all() { return this.sql.exec('SELECT * FROM orders ORDER BY created_at').toArray().map((r) => this.row(r)); }
}

function ownerPage(all) {
  const red = all.filter((o) => o.redeemedAt);
  const sum = (a) => a.reduce((t, o) => t + (o.total || 0), 0);
  const byKind = {};
  for (const o of red) byKind[o.kind] = (byKind[o.kind] || 0) + 1;
  const avg = red.length ? sum(red) / red.length : 0;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = red.slice(-50).reverse().map((o) =>
    `<tr><td>#${o.code}</td><td>${esc(o.title)}</td><td>${o.party}</td><td>$${o.total.toFixed(2)}</td><td>${new Date(o.redeemedAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}</td></tr>`).join('');
  return `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Foodol · Owner stats</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:32px auto;padding:0 20px;color:#123a22}h1{font-size:24px}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}.c{background:#eef8f1;border-radius:14px;padding:16px}.c b{display:block;font-size:28px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px;border-bottom:1px solid #e3ece6}</style>
<h1>Foodol at Sausalido Cafe</h1><p>Every combo a cashier marked as redeemed.</p>
<div class=g><div class=c><b>${all.length}</b>combos picked</div><div class=c><b>${red.length}</b>redeemed</div><div class=c><b>$${sum(red).toFixed(2)}</b>Foodol sales</div><div class=c><b>$${avg.toFixed(2)}</b>average order</div></div>
<p>${Object.entries(byKind).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ') || 'No redemptions yet.'}</p>
<table><tr><th>Code</th><th>Combo</th><th>People</th><th>Total</th><th>Redeemed</th></tr>${rows}</table>`;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    const store = env.STORE.get(env.STORE.idFromName('main'));

    if (p === '/api/order' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const o = await store.create(b, url.searchParams.get('src'));
      return o.error ? json(o, 400) : json(o);
    }

    const m = p.match(/^\/api\/order\/([\w-]+)(\/redeem)?$/);
    if (m) {
      if (m[2] && req.method === 'POST') {
        const r = await store.redeem(m[1]);
        return json(r.body, r.status);
      }
      const o = await store.get(m[1]);
      return o ? json(o) : json({ error: 'not found' }, 404);
    }

    if (p === '/owner') {
      if (!env.OWNER_KEY || url.searchParams.get('key') !== env.OWNER_KEY) return new Response('Not allowed', { status: 403 });
      return new Response(ownerPage(await store.all()), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    // Everything else: the static app (unknown paths fall back to index.html).
    return env.ASSETS.fetch(req);
  },
};
