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

  // build(items, party, cravings, freeMin, opts) — opts: { popular: [ids], grace, hour }
  function build(items, party, craveList, freeMin, opts = {}) {
    const n = Math.max(1, Math.min(20, +party || 1));
    const freeName = String(opts.freeName || '').trim().toLowerCase();
    const live = items.filter((i) => i.on !== false && i.p > 0 && (!freeName || i.n.trim().toLowerCase() !== freeName)); // never sell the free item
    const popular = opts.popular && opts.popular.length ? opts.popular
      : live.filter((i) => (+i.pop || 0) >= 5).map((i) => i.id); // older menus: top-rated items stand in
    const sc = scorer(popular);
    const mains = live.filter((i) => i.k === 'main');
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
