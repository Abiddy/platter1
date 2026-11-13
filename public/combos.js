/* Foodol combo engine, shared by the guest app and the admin portal.
   Pure functions: give it the menu items, party size and cravings,
   and it returns up to three combos (fav, deal, adv). */
(function (root) {
  const KINDS = {
    fav: { badge: "Foodol's favorite", title: 'The Crowd Pleaser', cls: 'c-fav' },
    deal: { badge: 'Best value', title: 'The Smart Deal', cls: 'c-deal' },
    adv: { badge: 'Something new', title: 'The Adventure', cls: 'c-adv' },
  };
  // Combos aim at a normal per-person spend. The favorite is sized to clear
  // the free-item minimum, the deal stays cheap, the adventure sits between.
  const CAP_PP = { fav: 24, deal: 16, adv: 21 };

  function score(i, how) {
    if (how === 'fav') return i.pop * 10 - i.p * 0.1;
    if (how === 'deal') return -i.p + i.pop * 0.3;
    return (6 - i.pop) * 4 + (i.id.charCodeAt(0) % 3);
  }

  function pool(items, craves) {
    const live = items.filter((i) => i.on !== false && i.p > 0 && i.k !== 'drink');
    if (craves.has('surprise')) return live.filter((i) => !i.c.includes('breakfast') || i.c.includes('sweet'));
    return live.filter((i) => i.c.some((c) => craves.has(c)));
  }

  function mix(list, how, craves) {
    // round-robin across the chosen cravings so every craving shows up
    const cats = craves.has('surprise') ? ['all'] : [...craves];
    const per = cats.map((c) => list.filter((i) => c === 'all' || i.c.includes(c)).sort((a, b) => score(b, how) - score(a, how)));
    const out = [];
    for (let r = 0; r < list.length; r++) for (const l of per) if (l[r] && !out.includes(l[r])) out.push(l[r]);
    return out;
  }

  function make(items, n, craves, how, freeMin) {
    const all = pool(items, craves);
    const mains = mix(all.filter((i) => i.k === 'main'), how, craves);
    if (!mains.length) return null;
    const sides = all.filter((i) => i.k === 'side').sort((a, b) => score(b, how) - score(a, how));
    const variety = Math.max(1, Math.min(mains.length, Math.max(n <= 2 ? n : Math.ceil(n * 0.7), craves.has('surprise') ? 1 : Math.min(craves.size, n))));
    const counts = new Map();
    for (let k = 0; k < n; k++) { const m = mains[k % variety]; counts.set(m, (counts.get(m) || 0) + 1); }
    const ns = n === 1 ? (sides.length && how !== 'deal' ? 1 : 0) : Math.ceil(n / 2);
    for (let k = 0; k < ns && sides.length; k++) { const s = sides[k % Math.min(sides.length, 2)]; counts.set(s, (counts.get(s) || 0) + 1); }
    const cap = CAP_PP[how] * n;
    const sum = () => [...counts].reduce((t, [i, q]) => t + i.p * q, 0);
    const cheaperMains = [...mains].sort((a, b) => a.p - b.p);
    for (let g = 0; g < 40 && sum() > cap; g++) {
      const sideIn = [...counts.keys()].filter((i) => i.k === 'side');
      if (sideIn.length && (n < 4 || sideIn.reduce((t, i) => t + counts.get(i), 0) > 1)) {
        const sd = sideIn.sort((a, b) => b.p - a.p)[0]; counts.set(sd, counts.get(sd) - 1); if (!counts.get(sd)) counts.delete(sd); continue;
      }
      const top = [...counts.keys()].filter((i) => i.k === 'main').sort((a, b) => b.p - a.p)[0];
      const alt = cheaperMains.find((c) => c.p < top.p);
      if (!alt) break;
      counts.set(top, counts.get(top) - 1); if (!counts.get(top)) counts.delete(top); counts.set(alt, (counts.get(alt) || 0) + 1);
    }
    // The favorite should come with the free item: if it lands just short,
    // add the cheapest side that gets it over the line (within the cap).
    if (how === 'fav' && freeMin && sum() < freeMin) {
      const gap = freeMin - sum();
      const add = sides.slice().sort((a, b) => a.p - b.p).find((s) => s.p >= gap && sum() + s.p <= cap + 6);
      if (add) counts.set(add, (counts.get(add) || 0) + 1);
    }
    const lines = [...counts].map(([i, q]) => ({ i, q })).sort((a, b) => (a.i.k === 'main' ? 0 : 1) - (b.i.k === 'main' ? 0 : 1));
    const total = Math.round(lines.reduce((t, l) => t + l.i.p * l.q, 0) * 100) / 100;
    return { how, lines, total, key: lines.map((l) => l.i.id + l.q).join() };
  }

  function build(items, party, craveList, freeMin) {
    const craves = new Set(craveList);
    const seen = new Set(), out = [];
    for (const how of ['fav', 'deal', 'adv']) {
      const c = make(items, party, craves, how, freeMin);
      if (c && !seen.has(c.key)) { seen.add(c.key); out.push(c); }
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
