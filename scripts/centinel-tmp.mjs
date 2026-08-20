/**
 * Scratch dir for Centinel bounces. Loop / listen / render prune so named
 * `--out=` wavs never accumulate (was ~450MB of per-build bounces and listen clips).
 */
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TMP_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)), ".tmp_centinel");

export function ensureTmp() {
  mkdirSync(TMP_DIR, { recursive: true });
}

export function isInsideTmp(path) {
  const rel = relative(TMP_DIR, resolve(path));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

/**
 * Delete everything in `.tmp_centinel` except `keep` (files or dirs).
 * Ancestors of a kept file are walked, not removed; siblings are.
 */
export function pruneTmp(keep = []) {
  ensureTmp();
  const keepAbs = [
    ...new Set(
      keep.filter(Boolean).map((p) => resolve(p)).filter((p) => isInsideTmp(p)),
    ),
  ];
  const keepSet = new Set(keepAbs);

  function relation(abs) {
    if (keepSet.has(abs)) return "exact";
    for (const k of keepSet) {
      const underKeep = relative(k, abs);
      if (
        underKeep &&
        !underKeep.startsWith("..") &&
        !underKeep.startsWith("/")
      )
        return "under";
      const keepUnderAbs = relative(abs, k);
      if (
        keepUnderAbs &&
        !keepUnderAbs.startsWith("..") &&
        !keepUnderAbs.startsWith("/")
      )
        return "ancestor";
    }
    return null;
  }

  let removed = 0;
  function walk(dir) {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = join(dir, name);
      const why = relation(abs);
      if (why === "exact" || why === "under") continue;
      if (why === "ancestor") {
        try {
          if (statSync(abs).isDirectory()) walk(abs);
        } catch {
          /* gone */
        }
        continue;
      }
      rmSync(abs, { recursive: true, force: true });
      removed++;
    }
  }
  walk(TMP_DIR);
  if (removed)
    console.log(`[centinel:tmp] removed ${removed} leftover(s) from .tmp_centinel`);
}
