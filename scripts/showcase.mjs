// scripts/showcase.mjs — record a nav tour of a running site and convert to GIF.
// Records a real video with Playwright (captures the page exactly as it renders,
// background video and all), then ffmpeg converts it. Requires a running server.
import { parseArgs } from "node:util";
import { mkdir, rm, readdir, rename } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const { values: f } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    viewport: { type: "string", default: "1280x800" },
    delay: { type: "string", default: "1500" }, // ms settle on first load
    dwell: { type: "string", default: "2500" }, // ms to hold on each nav target
    out: { type: "string", default: "showcase" },
    gif: { type: "boolean", default: true },
    mp4: { type: "boolean", default: false }, // also keep the raw mp4
    fps: { type: "string", default: "15" },
    scale: { type: "string", default: "960" }, // output width px
  },
});

const [w, h] = f.viewport.split("x").map(Number);

await rm(f.out, { recursive: true, force: true });
await mkdir(f.out, { recursive: true });

// real video autoplay needs the full browser, not the headless-shell, so the
// site's background <video> actually renders in the recording.
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: w, height: h },
  recordVideo: { dir: f.out, size: { width: w, height: h } },
});
const page = await context.newPage();

// The site's background <video> is z-index:-1, so it sits behind <body>, whose
// opaque `background:#111111` paints over it in screen capture (a live browser
// lets the negative-z layer show through; Playwright's compositor doesn't).
// Clearing the body bg reveals the video exactly as the site shows it — the
// video keeps its own brightness(0.3)/blur dimming. Re-applied after every
// navigation because a full route change (e.g. /events) drops injected styles.
const revealBgVideo = () =>
  page.addStyleTag({ content: "html,body{background:transparent!important}" }).catch(() => {});

await page.goto(new URL("/", f.base).href, { waitUntil: "networkidle" });
await revealBgVideo();
await page.waitForTimeout(Number(f.delay));

// discover nav links left->right by on-screen x position, click each in order
const links = await page.$$eval("nav a", (els) =>
  els
    .map((el) => ({ text: el.textContent.trim(), x: el.getBoundingClientRect().left }))
    .filter((l) => l.text)
    .sort((a, b) => a.x - b.x),
);
console.log("nav tour:", links.map((l) => l.text).join(" -> "));

await page.waitForTimeout(Number(f.dwell)); // dwell on the initial view
for (const { text } of links) {
  await page.getByRole("link", { name: text, exact: true }).first().click();
  await revealBgVideo(); // re-inject after route changes drop the style
  await page.waitForTimeout(Number(f.dwell));
  console.log("clicked", text);

  // After landing on Projects, open the first project card, dwell, then exit
  // back to the highlights — same dwell duration as every other beat.
  if (text.toLowerCase() === "projects") {
    const firstCard = page.locator("[data-project-card]").first();
    await firstCard.scrollIntoViewIfNeeded();
    await firstCard.click(); // navigates to /projects/<first> (lazy-loaded route)
    // wait for the standalone route to commit + the lazy chunk to render before
    // dwelling, else the recording shows the old homepage while it loads
    await page.waitForURL(/\/projects\//);
    await page.getByText("Back to Projects").waitFor({ state: "visible" });
    await revealBgVideo();
    await page.waitForTimeout(Number(f.dwell));
    console.log("opened first project");
    await page.goBack(); // exit back to the highlights
    await page.waitForURL((u) => !u.pathname.startsWith("/projects/"));
    await revealBgVideo();
    await page.waitForTimeout(Number(f.dwell));
    console.log("exited first project");
  }

  // On the Events page, slowly scroll the whole thing top -> bottom.
  if (text.toLowerCase() === "events") {
    await page.evaluate(async () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const durationMs = 4000; // slow, steady scroll
      const start = performance.now();
      await new Promise((resolve) => {
        const tick = (now) => {
          const t = Math.min(1, (now - start) / durationMs);
          window.scrollTo(0, max * t);
          t < 1 ? requestAnimationFrame(tick) : resolve();
        };
        requestAnimationFrame(tick);
      });
    });
    await page.waitForTimeout(Number(f.dwell)); // dwell at the bottom
    console.log("scrolled events page");
  }
}

// finalize the recording: video is written on context close
await context.close();
await browser.close();

const webm = (await readdir(f.out)).find((n) => n.endsWith(".webm"));
if (!webm) throw new Error("no recording produced");
const src = `${f.out}/tour.webm`;
await rename(`${f.out}/${webm}`, src);

// --- ffmpeg conversion ---
const ff = (args, out) => {
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (!existsSync(out) || statSync(out).size === 0) throw new Error(`ffmpeg produced no ${out}`);
  const probe = spawnSync("ffmpeg", ["-v", "error", "-i", out, "-f", "null", "-"]);
  if (probe.status !== 0) throw new Error(`ffmpeg wrote an invalid ${out}`);
};
const scale = `scale=${f.scale}:-2:flags=lanczos`;

if (f.gif) {
  ff(["-i", src, "-vf", `fps=${f.fps},${scale},split[a][b];[a]palettegen[p];[b][p]paletteuse`,
      `${f.out}/showcase.gif`], `${f.out}/showcase.gif`);
  console.log("wrote", `${f.out}/showcase.gif`);
}
if (f.mp4) {
  ff(["-i", src, "-vf", scale, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      `${f.out}/showcase.mp4`], `${f.out}/showcase.mp4`);
  console.log("wrote", `${f.out}/showcase.mp4`);
}

// keep only the requested artifacts; drop the raw recording unless --mp4 wanted it kept as source
await rm(src, { force: true });
