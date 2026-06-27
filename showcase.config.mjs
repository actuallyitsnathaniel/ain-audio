// showcase.config.mjs — the per-site tour. This is the ONLY file you edit to
// retarget the showcase to a different site. No Playwright plumbing here.
//
// Beats run top-to-bottom. Each beat holds for `dwell` ms (default from --dwell)
// so the recording has an even rhythm. Supported beats:
//   { visit: "/path" }                      goto a route
//   { navTour: true }                        click every <nav> link left->right
//   { clickNav: "Events",                    click one nav link by text:
//       waitText?: "book nathaniel" }        wait for this text after click (lazy routes)
//   { openClose: "<sel>",                    click first match, dwell, then exit:
//       waitText?: "Back to Projects",       wait for this text after opening (lazy routes)
//       back?: true }                        exit via browser back (default true)
//   { hover: "<sel>" }                       hover first match (hover-revealed UI)
//   { scrollPage: 4000 }                     smooth-scroll current page top->bottom over Nms
//   { dwell: 4000 }                          override hold for the PREVIOUS beat
//
// showVideo: true clears html/body background so a z-index:-1 background <video>
// shows in the capture (it stays dimmed by the site's own CSS). See skill step 5.
// waitBg: "<sel>"  wait for a post-mount-loaded bg <video>/<img> to PAINT before
//                  recording, so the GIF never opens on the fallback. See step 5b.
// keepIntro: true  keep the blank-load + first-paint entrance animation at the
//                  head of the gif (default trims it off). Use when the intro IS
//                  the moment you want to show.
// trimStart: N     drop the first N frames off the export head (stacks on the
//                  head-trim). Flag --trimStart overrides this.

export default {
  base: "http://localhost:3000", // MATCH the dev server port
  showVideo: true,
  // keepIntro: true keeps the blank-load + hero entrance animation at the head of
  // the recording instead of trimming it off — it's the intended opening here.
  keepIntro: true,
  beats: [
    // (initial home dwell happens before the first beat — hero settles in view)
    { clickNav: "Projects" },
    {
      openClose: "[data-project-card][href='/projects/riley']",
      waitText: "Back to Projects",
      back: false,
    },
    {
      openClose: ".group.p-3",
      waitText: "With the Rain",
      back: true,
    },
    { clickNav: "Press" }, // #press anchor (still on home route)
    { clickNav: "Events", waitText: "book nathaniel" }, // lazy /events route — wait for it to paint
    { scrollPage: 5000 }, // slow-scroll the full events page
  ],
};
