// Self-check for db-fader.ts — the dB taper is an audio path with an inverse that
// must round-trip. Run: `node src/daw/db-fader.check.mjs`
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("FAIL:", m); } else console.log("ok:", m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

const MAX_DB = 6, MIN_DB = -60, UNITY_POS = 0.75;
const db2lin = (db) => Math.pow(10, db / 20);
const lin2db = (g) => (g > 1e-6 ? 20 * Math.log10(g) : -Infinity);
function posToDb(p) { p = Math.min(1, Math.max(0, p)); if (p <= 0) return -Infinity; if (p >= UNITY_POS) return (MAX_DB * (p - UNITY_POS)) / (1 - UNITY_POS); return MIN_DB * (1 - p / UNITY_POS); }
function posToGain(p) { const db = posToDb(p); return db === -Infinity ? 0 : db2lin(db); }
function gainToPos(g) { if (g <= 0) return 0; const db = lin2db(g); if (db >= 0) return UNITY_POS + (db / MAX_DB) * (1 - UNITY_POS); return Math.max(0, UNITY_POS * (1 - db / MIN_DB)); }

ok(posToDb(0) === -Infinity, "p=0 → −∞");
ok(near(posToDb(UNITY_POS), 0), "p=0.75 → 0 dB (unity)");
ok(near(posToDb(1), MAX_DB), "p=1 → +6 dB");
ok(near(posToGain(UNITY_POS), 1), "unity pos → gain 1.0");
ok(near(posToGain(1), db2lin(6)), "top → gain ~1.995");
ok(posToGain(0) === 0, "p=0 → gain 0");

let prev = -1;
for (let p = 0; p <= 1.0001; p += 0.01) { const g = posToGain(p); ok(g >= prev - 1e-9, `monotonic at p=${p.toFixed(2)}`); prev = g; }

for (const p of [0.1, 0.3, 0.5, 0.75, 0.9, 1.0]) ok(near(gainToPos(posToGain(p)), p, 1e-4), `round-trip p=${p}`);
ok(near(gainToPos(1.0), UNITY_POS), "legacy vol 1.0 → unity pos");
{ const pos = gainToPos(0.8); ok(pos > 0.6 && pos < UNITY_POS, `legacy vol 0.8 → pos ${pos.toFixed(3)}`); }

if (fails) process.exit(1);
console.log("\nall db-fader checks passed");
