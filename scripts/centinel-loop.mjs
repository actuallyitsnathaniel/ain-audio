#!/usr/bin/env node
/**
 * Centinel agent loop step: headless render → score vs AT goal.
 *
 *   npm run centinel:loop
 *   npm run centinel:loop -- --dry=~/Downloads/dry.wav --goal=~/Downloads/output_goal.wav
 *
 * Needs `npm run dev` (Vite) so the worklet can be addModule'd.
 * Writes `.tmp_centinel/render.wav` + `.tmp_centinel/score.json`.
 * Prunes that folder to the current bounce + score so named `--out=` wavs
 * do not accumulate.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreCentinel } from "./centinel-score.mjs";
import { TMP_DIR, ensureTmp, isInsideTmp, pruneTmp } from "./centinel-tmp.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const home = process.env.HOME || "";

function parseArgs(argv) {
  const out = {
    dry: process.env.CENTINEL_DRY || resolve(home, "Downloads/dry.wav"),
    goal: process.env.CENTINEL_GOAL || resolve(home, "Downloads/output_goal.wav"),
    out: resolve(root, ".tmp_centinel/render.wav"),
    base: process.env.CENTINEL_BASE || "http://localhost:3000",
    preset: "pop",
    latencySamp: 1024,
    scoreOnly: null,
    /** Extra flags forwarded to centinel-render.mjs (--formant=0, --speed=…, …). */
    renderExtra: [],
  };
  for (const a of argv) {
    if (a.startsWith("--dry=")) out.dry = resolve(a.slice(6).replace(/^~/, home));
    else if (a.startsWith("--goal="))
      out.goal = resolve(a.slice(7).replace(/^~/, home));
    else if (a.startsWith("--out=")) out.out = resolve(a.slice(6));
    else if (a.startsWith("--base=")) out.base = a.slice(7);
    else if (a.startsWith("--preset=")) out.preset = a.slice(9);
    else if (a.startsWith("--latency-samp="))
      out.latencySamp = Number(a.slice(15));
    else if (a.startsWith("--score-only="))
      out.scoreOnly = resolve(a.slice(13).replace(/^~/, home));
    else if (
      a.startsWith("--formant=") ||
      a.startsWith("--speed=") ||
      a.startsWith("--humanize=") ||
      a.startsWith("--tracking=") ||
      a.startsWith("--key=")
    ) {
      out.renderExtra.push(a);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureTmp();
  const scorePath = resolve(TMP_DIR, "score.json");
  pruneTmp(
    args.scoreOnly && isInsideTmp(args.scoreOnly) ? [args.scoreOnly] : [],
  );

  let wetPath = args.scoreOnly;
  let build = null;
  if (!wetPath) {
    console.log("[centinel:loop] rendering…");
    const r = spawnSync(
      process.execPath,
      [
        resolve(root, "scripts/centinel-render.mjs"),
        `--dry=${args.dry}`,
        `--out=${args.out}`,
        `--base=${args.base}`,
        `--preset=${args.preset}`,
        ...args.renderExtra,
      ],
      { encoding: "utf8", cwd: root },
    );
    if (r.status !== 0) {
      console.error(r.stdout);
      console.error(r.stderr);
      process.exit(r.status || 1);
    }
    try {
      const meta = JSON.parse(r.stdout.trim().split("\n").slice(-50).join("\n").match(/\{[\s\S]*\}/)?.[0] || r.stdout);
      build = meta.build;
      console.log(`[centinel:loop] build ${build}`);
    } catch {
      console.log(r.stdout);
    }
    wetPath = args.out;
  }

  console.log("[centinel:loop] scoring…");
  const score = scoreCentinel({
    dryPath: args.dry,
    wetPath,
    goalPath: args.goal,
    latencySamp: args.latencySamp,
    key: 9,
  });
  score.build = build;
  score.wetPath = wetPath;

  writeFileSync(scorePath, JSON.stringify(score, null, 2));
  const keep = [scorePath];
  if (isInsideTmp(wetPath)) keep.push(wetPath);
  pruneTmp(keep);

  // Compact agent-facing card
  const card = {
    build: score.build,
    center_le15: +score.center.le15.toFixed(1),
    goal_le15:
      score.goalCenterLe15 != null ? +score.goalCenterLe15.toFixed(1) : null,
    loose_runs: score.loose.runs,
    goal_loose_runs: score.goalLoose?.runs ?? null,
    owned_note_miss_pct: +score.ownedNoteMissPct.toFixed(1),
    note_disagree_pct:
      score.noteDisagreePct != null
        ? +score.noteDisagreePct.toFixed(1)
        : null,
    dry_at_agree_wet_wrong: score.noteDisagreeDryAtFrames,
    shake_rate: +score.shake.rate.toFixed(3),
    clicks_wet: score.clicks.wet,
    clicks_dry: score.clicks.dry,
    dip_runs: score.dips.runs,
    dip_ms: +score.dips.ms.toFixed(0),
    wet: wetPath,
    scoreJson: scorePath,
  };
  console.log("\n=== SCORECARD ===");
  console.log(JSON.stringify(card, null, 2));
}

main();
