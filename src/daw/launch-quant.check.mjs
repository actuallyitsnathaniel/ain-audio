// Self-check for the launch-quantize boundary math (engine.nextQuantBoundary).
// Mirrors the logic: next quantum boundary strictly after `from`, respecting a loop
// brace (boundaries measured from brace start; a boundary at/after brace end wraps to
// the brace start). Run: `node src/daw/launch-quant.check.mjs`
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("FAIL:", m); } else console.log("ok:", m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

function nextQuantBoundary(from, q, brace) {
  if (q <= 0) return from;
  const origin = brace ? brace.start : 0;
  const rel = from - origin;
  const next = origin + (Math.floor(rel / q + 1e-9) + 1) * q;
  if (brace && next >= brace.end - 1e-9) return brace.start;
  return next;
}

// no brace — plain multiples of q, strictly after `from`
ok(near(nextQuantBoundary(0, 4), 4), "from 0, q=4 → 4");
ok(near(nextQuantBoundary(1.5, 4), 4), "from 1.5, q=4 → 4");
ok(near(nextQuantBoundary(4, 4), 8), "from exactly 4, q=4 → 8 (strictly after)");
ok(near(nextQuantBoundary(3.9, 1), 4), "from 3.9, q=1 → 4");
ok(near(nextQuantBoundary(0.1, 0.5), 0.5), "from 0.1, q=0.5 → 0.5");
ok(near(nextQuantBoundary(7.2, 2), 8), "from 7.2, q=2 → 8");

// q=0 → identity (immediate, no quantize)
ok(nextQuantBoundary(5.3, 0) === 5.3, "q=0 → from unchanged");

// with a loop brace [4, 12) — boundaries measured from 4
const br = { start: 4, end: 12 };
ok(near(nextQuantBoundary(4, 4, br), 8), "brace [4,12): from 4, q=4 → 8");
ok(near(nextQuantBoundary(5, 4, br), 8), "brace: from 5, q=4 → 8");
ok(near(nextQuantBoundary(9, 4, br), 4), "brace: from 9, q=4 → wraps to brace start (next would be 12 = end)");
ok(near(nextQuantBoundary(8, 4, br), 4), "brace: from 8, q=4 → next is 12=end → wrap to 4");
ok(near(nextQuantBoundary(11.5, 1, br), 4), "brace: from 11.5, q=1 → next 12=end → wrap to 4");
ok(near(nextQuantBoundary(6.5, 1, br), 7), "brace: from 6.5, q=1 → 7");

// brace not bar-aligned to origin: [3, 11), q=2 → boundaries 3,5,7,9,(11=end→wrap)
const br2 = { start: 3, end: 11 };
ok(near(nextQuantBoundary(3, 2, br2), 5), "brace [3,11): from 3, q=2 → 5");
ok(near(nextQuantBoundary(8.5, 2, br2), 9), "brace [3,11): from 8.5, q=2 → 9");
ok(near(nextQuantBoundary(9.5, 2, br2), 3), "brace [3,11): from 9.5, q=2 → next 11=end → wrap to 3");

// firing detection sanity: a boundary is always > from (or the wrap point ≤ from)
for (const f of [0, 0.3, 1, 3.7, 7.99, 11.2]) {
  const b = nextQuantBoundary(f, 1, br);
  ok(b > f - 1e-9 || b === br.start, `boundary ${b} valid for from ${f}`);
}

if (fails) process.exit(1);
console.log("\nall launch-quant checks passed");
