/* Foodol combo engine, shared by the guest app and the restaurant portal.
   Pure functions: give it the menu items, party size, cravings and the
   restaurant's ranked popular dishes, and it returns up to three combos.

   How it decides:
   1. Every dish gets a score. The restaurant's "Popular dishes" list matters
      most (the #1 dish scores highest); the 1–5 popularity only breaks ties.
   2. Each person gets a main from what they're craving. With several
      cravings, Foodol takes turns between them so each craving shows up.
      Groups get some variety, and the best dishes repeat for the rest.
   3. Groups get shared sides (1 per 2–3 people) that go with the mains:
      fries with sandwiches, curry puffs with Thai, desserts only if the
      guest asked for something sweet. Drinks are never added.
   4. Every combo tries to earn the free item: if it's short of the minimum,
      Foodol adds the side that fits best, or upgrades a main.
   The three combos:
   - fav  "Crowd Pleaser": the most popular dishes.
   - deal "Smart Deal":    the cheapest well-liked order that still gets the free item.
   - adv  "Something new": the next-best dishes, different from the Crowd Pleaser.
   - feast "Extra hungry": the favorites plus an extra side (and a drink for one person).
   - wild "Wildcard":      dishes none of the other combos used. */
(function (root) {
  const KINDS = {
    fav: { badge: "Foodol's favorite", title: 'The Crowd Pleaser', cls: 'c-fav' },
    deal: { badge: 'Best value', title: 'The Smart Deal', cls: 'c-deal' },
    adv: { badge: 'Something new', title: 'The Adventure', cls: 'c-adv' },
    feast: { badge: 'Extra hungry', title: 'The Feast', cls: 'c-feast' },
    wild: { badge: 'Wildcard', title: 'The Wildcard', cls: 'c-wild' },
  };
  const ORDER = ['fav', 'deal', 'adv', 'feast', 'wild'];
  const CAP_PP = { fav: 27, deal: 22, adv: 25, feast: 34, wild: 25 }; // soft per-person ceiling
  const r2 = (v) => Math.round(v * 100) / 100;

  function scorer(popular) {
    const rank = new Map((popular || []).map((id, i) => [id, i]));
    return (i) => (rank.has(i.id) ? 100 - Math.min(rank.get(i.id), 20) * 3 : 0) + (+i.pop || 3) * 6;
  }

  // Which cravings to rotate through. "Surprise me" uses the menu's own
  // categories, skipping breakfast after 11am, led by the most popular one.
  function cravingsFor(mains, craves, sc, hour) {
    if (!craves.includes('surprise')) return craves.filter((c) => mains.some((m) => m.c.includes(c)));
    const tags = [...new Set(mains.flatMap((m) => m.c))].filter((t) => hour < 11 || t !== 'breakfast');
    const best = (t) => Math.max(...mains.filter((m) => m.c.includes(t)).map(sc)) + (hour < 11 && t === 'breakfast' ? 60 : 0);
    const list = tags.sort((a, b) => best(b) - best(a));
    return list.length ? list : [...new Set(mains.flatMap((m) => m.c))];
  }

  function fits(item, cats) { return item.c.some((c) => cats.includes(c)); }

  function pickMains(mains, cats, n, order, skip) {
    const per = cats.map((c) => mains.filter((m) => m.c.includes(c) && !skip.has(m.id)).sort(order));
    const want = n === 1 ? 1 : n === 2 ? 2 : Math.ceil(n * 0.75);
    const picks = [];
    for (let r = 0; picks.length < want && r < mains.length; r++) {
      let added = false;
      for (const l of per) { const m = l.find((x) => !picks.includes(x)); if (m && picks.length < want) { picks.push(m); added = true; } }
      if (!added) break;
    }
    if (!picks.length) return null;
    const counts = new Map();
    for (let k = 0; k < n; k++) { const m = picks[k % picks.length]; counts.set(m, (counts.get(m) || 0) + 1); }
    return counts;
  }

  const total = (counts) => r2([...counts].reduce((t, [i, q]) => t + i.p * q, 0));

  function make(how, ctx, used) {
    const { mains, sides, cats, sweet, n, sc, freeLine } = ctx;
    const liked = (i) => sc(i) >= ctx.likedBar;
    const byScore = (a, b) => sc(b) - sc(a) || a.p - b.p;
    const byValue = (a, b) => a.p - b.p || sc(b) - sc(a);
    let counts;

    if (n === 1) return solo(how, ctx, used);

    const pool = how === 'deal' ? mains.filter(liked) : mains;
    const skip = how === 'adv' || how === 'wild' ? used : new Set();
    counts = pickMains(pool.length ? pool : mains, cats, n, how === 'deal' ? byValue : byScore, skip)
      || pickMains(mains, cats, n, byScore, new Set());
    if (!counts) return null;

    // shared sides that go with the chosen mains
    const chosen = [...counts.keys()];
    const sideList = sides.filter((sd) => chosen.some((m) => goesWith(sd, m, sweet))).sort(how === 'deal' ? byValue : byScore);
    const sideOrder = how === 'adv' || how === 'wild' ? sideList.filter((s) => !used.has(s.id)).concat(sideList.filter((s) => used.has(s.id))) : sideList;
    const ns = (n === 1 ? 0 : n <= 3 ? 1 : n <= 5 ? 2 : 3) + (how === 'feast' ? 1 : 0);
    for (let k = 0; k < ns && sideOrder.length; k++) { const s = sideOrder[k % Math.min(sideOrder.length, how === 'feast' ? 3 : 2)]; counts.set(s, (counts.get(s) || 0) + 1); }

    // keep it a normal spend per person: drop extra sides, then swap the priciest main for a cheaper liked one
    const cap = CAP_PP[how] * n;
    for (let g = 0; g < 30 && total(counts) > cap; g++) {
      const sideIn = [...counts.keys()].filter((i) => i.k === 'side');
      if (sideIn.length && n > 1 && sideIn.reduce((t, i) => t + counts.get(i), 0) > 1) {
        const sd = sideIn.sort((a, b) => b.p - a.p)[0]; counts.set(sd, counts.get(sd) - 1); if (!counts.get(sd)) counts.delete(sd); continue;
      }
      const top = [...counts.keys()].filter((i) => i.k === 'main').sort((a, b) => b.p - a.p)[0];
      const alt = pool.filter((c) => c.p < top.p && c.c.some((t) => top.c.includes(t))).sort(byScore)[0];
      if (!alt) break;
      counts.set(top, counts.get(top) - 1); if (!counts.get(top)) counts.delete(top); counts.set(alt, (counts.get(alt) || 0) + 1);
    }

    // earn the free item: add the best-fitting side that clears the line, else upgrade a main
    if (freeLine && total(counts) < freeLine) {
      const gap = freeLine - total(counts);
      const add = sideList.filter((s) => s.p >= gap).sort(how === 'deal' ? byValue : byScore)[0];
      if (add) counts.set(add, (counts.get(add) || 0) + 1);
      else {
        const low = [...counts.keys()].filter((i) => i.k === 'main').sort((a, b) => a.p - b.p)[0];
        const up = pool.filter((c) => c.p >= low.p + gap && c.c.some((t) => low.c.includes(t))).sort(how === 'deal' ? byValue : byScore)[0];
        if (up) { counts.set(low, counts.get(low) - 1); if (!counts.get(low)) counts.delete(low); counts.set(up, (counts.get(up) || 0) + 1); }
        else { const any = sideList.sort((a, b) => b.p - a.p)[0]; if (any) counts.set(any, (counts.get(any) || 0) + 1); }
      }
    }
    return finish(how, counts);
  }

  // A side goes with a main when it's from another part of the menu (no
  // bagel next to a panini) and suits the main's main craving (fries with a
  // sandwich, curry puffs with Thai). Desserts only if they asked for sweet.
  function goesWith(side, main, sweet) {
    if (side.s === main.s) return false;
    const mainName = main.n.toLowerCase(); // no fries next to "Chicken Strips & Fries"
    if (side.n.toLowerCase().split(/[^a-z]+/).some((w) => w.length > 3 && mainName.includes(w))) return false;
    if (side.c.length && side.c.every((c) => c === 'sweet')) return sweet; // desserts
    return side.c.includes(main.c[0]);
  }

  // One person: compare every main on its own and with each side that goes
  // with it (or a popular drink, only when nothing else reaches the free item).
  function solo(how, ctx, used) {
    const { mains, sides, drinks, cats, sweet, sc, freeLine } = ctx;
    const cap = Math.max(CAP_PP[how], freeLine + 5);
    const ms = mains.filter((m) => fits(m, cats) && (how !== 'deal' || sc(m) >= ctx.likedBar) && ((how !== 'adv' && how !== 'wild') || !used.has(m.id)));
    const cands = [];
    for (const m of ms) {
      const adds = [null].concat(sides.filter((sd) => goesWith(sd, m, sweet)));
      const qualifiesAlone = !freeLine || m.p >= freeLine || adds.some((a) => a && m.p + a.p >= freeLine);
      if (!qualifiesAlone) adds.push(...drinks);
      if (how === 'feast') {
        // main + a side that goes with it + a popular drink
        let extras = adds.filter((a) => a && a.k === 'side');
        if (!extras.length) extras = mains.filter((x) => x.s !== m.s && fits(x, cats) && x.c[0] !== m.c[0] || (x.s !== m.s && fits(x, cats) && x.c.includes('sweet') !== m.c.includes('sweet'))).slice(0, 6); // no side fits: a second dish
        for (const sd of extras) for (const d of extras[0] && extras[0].k === 'main' ? [null] : drinks) {
          const t = r2(m.p + sd.p + (d ? d.p : 0));
          cands.push({ m, a: sd, d, t, ok: !freeLine || t >= freeLine, v: sc(m) + sc(sd) * 0.15 + (d ? sc(d) * 0.1 : 0), over: t > cap });
        }
        continue;
      }
      for (const a of adds) {
        const t = r2(m.p + (a ? a.p : 0));
        const ok = !freeLine || t >= freeLine;
        let v = sc(m) + (a ? sc(a) * 0.15 : 0) - (a && a.k === 'drink' ? 12 : 0) - (a && freeLine && m.p >= freeLine ? 10 : 0);
        if ((how === 'adv' || how === 'wild') && a && used.has(a.id)) v -= 4;
        if (ctx.surprise && ctx.hour < 11 && m.c.includes('breakfast')) v += 25; // mornings lean breakfast
        if (how === 'deal' && ctx.favKey === m.id + '|' + (a ? a.id : '')) continue;
        cands.push({ m, a, t, ok, v, over: t > cap });
      }
    }
    if (!cands.length) return null;
    const anyOk = cands.some((c) => c.ok && !c.over);
    const pool = cands.filter((c) => (anyOk ? c.ok && !c.over : true));
    const pick = how === 'deal'
      ? pool.sort((x, y) => x.t - y.t || y.v - x.v)[0]
      : pool.sort((x, y) => y.v - x.v || x.t - y.t)[0];
    if (how === 'fav') ctx.favKey = pick.m.id + '|' + (pick.a ? pick.a.id : '');
    const counts = new Map([[pick.m, 1]]); if (pick.a) counts.set(pick.a, 1); if (pick.d) counts.set(pick.d, 1);
    return finish(how, counts);
  }

  function finish(how, counts) {
    const lines = [...counts].map(([i, q]) => ({ i, q })).sort((a, b) => (a.i.k === 'main' ? 0 : 1) - (b.i.k === 'main' ? 0 : 1) || b.q - a.q);
    return { how, lines, total: total(counts), key: lines.map((l) => l.i.id + 'x' + l.q).sort().join() };
  }

  // Guest preferences. Halal and vegetarian are strict: Foodol only suggests
  // items tagged for them (drinks always pass; halal also allows vegetarian
  // and seafood items). The rest just make matching dishes score higher.
  const STRICT = {
    halal: (i) => i.k === 'drink' || (i.t || []).some((x) => x === 'halal' || x === 'vegetarian' || x === 'seafood'),
    vegetarian: (i) => i.k === 'drink' || (i.t || []).includes('vegetarian'),
  };
  /* ---------- Combo library ----------
     A restaurant can have a hand-checked library of single-person combos
     ("plates"), written once by AI from the menu, the restaurant's reviews and
     its neighbourhood, then approved by the owner. At order time every plate
     gets a weighted score and Foodol shows the best ones:
       craving fit ........ high   (plates that don't match a craving are skipped)
       halal / vegetarian . hard rule (every item must pass)
       learned pick rate .. high, grows as real guests pick or skip a plate
       review love (rv) ... medium (dishes people rave about in reviews)
       owner feature (b) .. medium (new dish, high margin, stock to move)
       popular list ....... medium
       time of day ........ medium
       soft preferences ... medium (savory, breakfast, lunch, spicy)
       earns free item .... small push; plate weight (w) set by AI/owner
       freshness .......... small per-visit jitter so the top pick rotates
     Groups get one plate per person, mixing cravings and avoiding repeats. */
  const SLOT = (h) => (h < 11 ? 'morning' : h < 14 ? 'midday' : h < 17 ? 'afternoon' : 'evening');
  function hash(s) { let h = 2166136261; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; }

  function scorePlates(lib, byId, ctx) {
    const { craves, surprise, slot, prefs, soft, base, stats, seed, freeLine, halalMain } = ctx;
    const sum = Object.values(stats || {}).reduce((a, v) => [a[0] + (+v[0] || 0), a[1] + (+v[1] || 0)], [0, 0]);
    const prior = (sum[1] + 1) / (sum[0] + 8);
    const out = [];
    for (const pl of lib) {
      if (pl.on === false) continue;
      const lines = [];
      let ok = true;
      for (const x of pl.items || []) { const it = byId.get(x.id); if (!it) { ok = false; break; } lines.push({ i: it, q: Math.max(1, +x.q || 1) }); }
      if (!ok || !lines.length) continue; // an item is off, sold out, or fails halal/vegetarian
      const mains = lines.filter((l) => l.i.k === 'main').map((l) => l.i);
      if (!mains.length) continue;
      const cr = pl.cr || [];
      if (halalMain && !mains.some((m) => (m.t || []).includes('halal'))) continue; // halal guests: chicken (halal) main first
      const hit = surprise ? cr.length : cr.filter((c) => craves.includes(c)).length;
      if (!surprise && !hit && !halalMain) continue;
      const parts = {};
      // a main dish that isn't any of the picked cravings (a Thai plate for someone who asked for sweet) ranks lower
      const offMains = surprise || halalMain ? 0 : mains.filter((m) => !m.c.some((c) => craves.includes(c))).length;
      parts.craving = surprise ? 40 : hit ? 60 + (hit - 1) * 15 - offMains * 35 : 0; // (no hit only happens for halal guests: plates that also match the craving come first)
      parts.time = !pl.tm || !pl.tm.length ? 0 : pl.tm.includes(slot) ? 30 : -35;
      parts.popular = Math.round(mains.reduce((t, m) => t + base(m), 0) / mains.length * 0.35);
      parts.reviews = Math.min(40, lines.reduce((t, l) => t + (+l.i.rv || 0) * 8, 0));
      parts.owner = lines.some((l) => l.i.b) ? 30 : 0;
      parts.prefs = soft.reduce((t, p) => t + 45 * mains.filter((m) => (m.t || []).includes(p)).length / mains.length, 0)
        + (prefs.includes('halal') && mains.some((m) => (m.t || []).includes('halal')) ? 70 : 0);
      const st = (stats || {})[pl.id];
      parts.learned = st ? Math.max(-30, Math.min(50, Math.round(((+st[1] || 0) + 1) / ((+st[0] || 0) + 8) * 200 - prior * 200))) : 0;
      const tot = r2(lines.reduce((t, l) => t + l.i.p * l.q, 0));
      parts.free = !freeLine ? 0 : tot >= freeLine ? 20 : -15;
      parts.weight = (+pl.w || 0) * 15;
      // size preferences work on every menu: light bite leans small, extra hungry leans big
      parts.size = prefs.includes('light') ? -tot * 3 + (lines.length <= 2 ? 25 : 0) : prefs.includes('hungry') ? tot * 3 + (lines.length >= 3 || mains.length > 1 ? 30 : 0) : 0;
      parts.fresh = Math.round(hash(pl.id + '|' + seed) * 14);
      const score = Object.values(parts).reduce((a, b) => a + b, 0);
      out.push({ pl, lines, mains, total: tot, score, parts, offMains, big: lines.length >= 3 || mains.length > 1 });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  // One combo for the whole party: a lead plate plus one more per person,
  // spreading cravings and avoiding the same main twice where possible.
  function assemble(lead, ranked, n, craves, avoid, how) {
    const chosen = [lead];
    const mainCount = new Map(); lead.mains.forEach((m) => mainCount.set(m.id, 1));
    const covered = new Set((lead.pl.cr || []).filter((c) => craves.includes(c)));
    while (chosen.length < n) {
      let best = null, bv = -1e9;
      for (const c of ranked) {
        const rep = c.mains.reduce((t, m) => t + (mainCount.get(m.id) || 0), 0);
        const fresh = (c.pl.cr || []).some((x) => craves.includes(x) && !covered.has(x)) ? 30 : 0;
        const off = c.offMains * 50; // stay on the group's cravings
        const v = c.score - rep * 45 + fresh - off - (chosen.includes(c) ? 25 : 0) - (avoid.has(c.pl.id) ? 70 : 0) - (how === 'deal' ? c.total * 4 : 0);
        if (v > bv) { bv = v; best = c; }
      }
      if (!best) break;
      chosen.push(best); best.mains.forEach((m) => mainCount.set(m.id, (mainCount.get(m.id) || 0) + 1));
      (best.pl.cr || []).forEach((c) => covered.add(c));
    }
    const counts = new Map();
    for (const c of chosen) for (const l of c.lines) counts.set(l.i, (counts.get(l.i) || 0) + l.q);
    return { counts, ids: chosen.map((c) => c.pl.id) };
  }

  function fromLibrary(live, n, craves, freeLine, opts, base, prefs, soft) {
    const byId = new Map(live.map((i) => [i.id, i]));
    const surprise = craves.includes('surprise');
    const hour = opts.hour ?? new Date().getHours();
    const halalMain = prefs.includes('halal') && live.some((i) => i.k === 'main' && (i.t || []).includes('halal'));
    const ranked = scorePlates(opts.library, byId, { craves, surprise, slot: SLOT(hour), prefs, soft, base, stats: opts.stats, seed: opts.seed || 0, freeLine, halalMain });
    if (!ranked.length) return [];
    const used = new Set(), out = [], seen = new Set(), avoid = new Set();
    const byPlate = new Map(ranked.map((c) => [c.pl.id, c]));
    const mainsOf = (c) => c.mains.map((m) => m.id);
    const top = ranked[0].score;
    const roles = {
      fav: () => ranked[0],
      deal: () => ranked.filter((c) => c !== ranked[0] && !seen.has(c.pl.id) && c.score >= top - 60 && (!freeLine || c.total >= freeLine))
        .sort((a, b) => a.total - b.total || b.score - a.score)[0],
      adv: () => ranked.find((c) => !c.offMains && mainsOf(c).every((id) => !used.has(id))) || ranked.find((c) => mainsOf(c).every((id) => !used.has(id))),
      // the biggest strong plate, preferring a dish not shown yet
      feast: () => { const big = ranked.filter((c) => c.big && c.total >= (freeLine || 0) && !seen.has(c.pl.id) && c.score >= top - 90);
        const pick = (l) => l.sort((a, b) => (b.score + b.total * 3) - (a.score + a.total * 3))[0];
        return pick(big.filter((c) => mainsOf(c).every((id) => !used.has(id)))) || pick(big); },
      wild: () => ranked.slice(2).find((c) => !c.offMains && mainsOf(c).every((id) => !used.has(id)) && c.mains[0].s !== ranked[0].mains[0].s)
        || ranked.slice(2).find((c) => !c.offMains && !seen.has(c.pl.id) && mainsOf(c).every((id) => !used.has(id)))
        || ranked.slice(3).find((c) => !seen.has(c.pl.id)),
    };
    for (const how of ORDER) {
      const lead = roles[how]();
      if (!lead) continue;
      const { counts, ids } = assemble(lead, ranked, n, craves, avoid, how);
      const c = finish(how, counts);
      if (seen.has(c.key)) continue;
      seen.add(c.key); seen.add(lead.pl.id); c.lib = ids; c.why = lead.parts; out.push(c);
      // later combos lean away from the plates and dishes this one used
      ids.forEach((id) => { avoid.add(id); const x = byPlate.get(id); if (x) mainsOf(x).forEach((m) => used.add(m)); });
    }
    return out;
  }

  // build(items, party, cravings, freeMin, opts) — opts: { popular: [ids], grace, hour, prefs: [tags], library, stats, seed }
  function build(items, party, craveList, freeMin, opts = {}) {
    const out = buildMain(items, party, craveList, freeMin, opts), pf = opts.prefs || [];
    // size preferences: light bite shows the smaller combos first, extra hungry the bigger ones
    if (pf.includes('light')) out.sort((a, b) => a.total - b.total);
    else if (pf.includes('hungry')) out.sort((a, b) => b.total - a.total);
    return out;
  }
  function buildMain(items, party, craveList, freeMin, opts = {}) {
    const res = buildRules(items, party, craveList, freeMin, opts);
    if (!opts.library || !opts.library.length) return res;
    const n = Math.max(1, Math.min(20, +party || 1));
    const freeName = String(opts.freeName || '').trim().toLowerCase();
    const prefs = (opts.prefs || []).filter(Boolean);
    const live = items.filter((i) => i.on !== false && i.p > 0 && (!freeName || i.n.trim().toLowerCase() !== freeName) && prefs.every((p) => !STRICT[p] || STRICT[p](i)));
    const popular = opts.popular && opts.popular.length ? opts.popular : live.filter((i) => (+i.pop || 0) >= 5).map((i) => i.id);
    const craves = craveList && craveList.length ? craveList : ['surprise'];
    const lib = fromLibrary(live, n, craves, freeMin ? freeMin - (opts.grace ?? 0.5) : 0, opts, scorer(popular), prefs, prefs.filter((p) => !STRICT[p]));
    if (lib.length >= 3) return lib;
    // library too thin for this request: top up with rule-built combos in the roles still free
    const have = new Set(lib.map((c) => c.how)), keys = new Set(lib.map((c) => c.key));
    return lib.concat(res.filter((c) => !have.has(c.how) && !keys.has(c.key))).sort((a, b) => ORDER.indexOf(a.how) - ORDER.indexOf(b.how));
  }

  function buildRules(items, party, craveList, freeMin, opts = {}) {
    const n = Math.max(1, Math.min(20, +party || 1));
    const freeName = String(opts.freeName || '').trim().toLowerCase();
    const prefs = (opts.prefs || []).filter(Boolean);
    const live = items.filter((i) => i.on !== false && i.p > 0 && (!freeName || i.n.trim().toLowerCase() !== freeName) // never sell the free item
      && prefs.every((p) => !STRICT[p] || STRICT[p](i)));
    const popular = opts.popular && opts.popular.length ? opts.popular
      : live.filter((i) => (+i.pop || 0) >= 5).map((i) => i.id); // older menus: top-rated items stand in
    const base = scorer(popular);
    const soft = prefs.filter((p) => !STRICT[p]);
    // halal guests see a halal dish first (not just a cheese crepe); other prefs boost matching dishes
    const sc = (i) => base(i) + soft.filter((p) => (i.t || []).includes(p)).length * 45 + (prefs.includes('halal') && (i.t || []).includes('halal') ? 70 : 0);
    let mains = live.filter((i) => i.k === 'main');
    // halal is the top priority: build every combo around a halal-tagged main (e.g. the chicken), whatever the craving
    const halalMains = prefs.includes('halal') ? mains.filter((m) => (m.t || []).includes('halal')) : [];
    if (halalMains.length) mains = halalMains;
    if (!mains.length) return [];
    const craves = (craveList && craveList.length ? craveList : ['surprise']);
    const hour = opts.hour ?? new Date().getHours();
    let cats = cravingsFor(mains, craves, sc, hour);
    if (!cats.length) cats = cravingsFor(mains, ['surprise'], sc, hour);
    const scores = mains.map(sc).sort((a, b) => a - b);
    const ctx = {
      n, sc, cats, hour, mains: craves.includes('surprise') ? mains.filter((m) => fits(m, cats)) : mains,
      sides: live.filter((i) => i.k === 'side'),
      drinks: live.filter((i) => i.k === 'drink' && sc(i) >= 24).sort((a, b) => sc(b) - sc(a)).slice(0, 4),
      sweet: craves.includes('sweet'), surprise: craves.includes('surprise'),
      likedBar: scores[Math.floor(scores.length * 0.35)] || 0,
      freeLine: freeMin ? freeMin - (opts.grace ?? 0.5) : 0,
    };
    const out = [], seen = new Set(), used = new Set();
    for (const how of ORDER) {
      const c = make(how, ctx, used);
      if (!c || seen.has(c.key)) continue;
      seen.add(c.key); out.push(c);
      if (how !== 'feast') c.lines.filter((l) => l.i.k === 'main' || how === 'fav').forEach((l) => used.add(l.i.id));
    }
    return out;
  }

  // Does this total earn the free item? A small grace keeps $19.98 from
  // reading as "add 2 cents".
  function qualifies(total, free) {
    return !!(free && free.on && total >= free.min - (free.grace || 0));
  }

  function topUp(items, total, free) {
    const rem = free.min - (free.grace || 0) - total;
    const extras = items.filter((i) => i.on !== false && i.p > 0 && i.k === 'side').sort((a, b) => a.p - b.p);
    return extras.find((i) => i.p >= rem) || extras[extras.length - 1];
  }

  root.FoodolCombos = { KINDS, build, qualifies, topUp };
})(typeof window !== 'undefined' ? window : globalThis);
