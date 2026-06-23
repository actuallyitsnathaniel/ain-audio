// showcase.config.mjs — the per-site tour. This is the ONLY file you edit to
// retarget the showcase to a different site. No Playwright plumbing here.
//
// Beats run top-to-bottom. Each beat holds for `dwell` ms (default from --dwell)
// so the recording has an even rhythm. Supported beats:
//   { visit: "/path" }                      goto a route
//   { navTour: true }                        click every <nav> link left->right
//   { clickNav: "Events" }                   click one nav link by text
//   { openClose: "<sel>",                    click first match, dwell, then exit:
//       waitText?: "Back to Projects",       wait for this text after opening (lazy routes)
//       back?: true }                        exit via browser back (default true)
//   { scrollPage: 4000 }                     smooth-scroll current page top->bottom over Nms
//   { dwell: 4000 }                          override hold for the PREVIOUS beat
//
// showVideo: true clears html/body background so a z-index:-1 background <video>
// shows in the capture (it stays dimmed by the site's own CSS). See skill step 5.

export default {
  base: "http://localhost:3000", // MATCH the dev server port
  showVideo: true,
  beats: [
    { visit: "/" }, // home (hero + bg video)
    { clickNav: "Projects" }, // scroll to project highlights
    { openClose: "[data-project-card]", waitText: "Back to Projects" }, // open first card, exit
    { clickNav: "Press" }, // scroll to press
    { clickNav: "Events" }, // navigate to events route
    { scrollPage: 4000 }, // slow-scroll the events page
  ],
};
