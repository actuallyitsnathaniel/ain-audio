import React, { lazy, useEffect, useRef } from "react";
import { Outlet } from "react-router-dom";

const AdidasMessi = lazy(() =>
  import("./projects/adidas-messi").then((m) => ({ default: m.AdidasMessi })),
);
const AubitSound = lazy(() =>
  import("./projects/aubit").then((m) => ({ default: m.AubitSound })),
);
const BrandX = lazy(() =>
  import("./projects/brand-x").then((m) => ({ default: m.BrandX })),
);
const JohnWhite = lazy(() =>
  import("./projects/john-white").then((m) => ({ default: m.JohnWhite })),
);
const KRPTK = lazy(() =>
  import("./projects/krptk").then((m) => ({ default: m.KRPTK })),
);
const PlatinumRoses = lazy(() =>
  import("./projects/platinum-roses").then((m) => ({
    default: m.PlatinumRoses,
  })),
);
const Riley = lazy(() =>
  import("./projects/riley").then((m) => ({ default: m.Riley })),
);
const Ryland = lazy(() =>
  import("./projects/ryland").then((m) => ({ default: m.Ryland })),
);
const SamDenton = lazy(() =>
  import("./projects/sam-denton").then((m) => ({ default: m.SamDenton })),
);

const ProjectHighlights = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle("is-centered", entry.isIntersecting);
        });
      },
      { root: null, threshold: 0.5, rootMargin: "-25% 0px -25% 0px" },
    );

    const attachObserver = () => {
      container
        .querySelectorAll<HTMLElement>("[data-project-card]")
        .forEach((card) => {
          observer.observe(card);
        });
    };

    // Watch for lazy-loaded cards appearing in the container
    const mutationObserver = new MutationObserver(attachObserver);
    mutationObserver.observe(container, { childList: true, subtree: true });

    // Also attach immediately for any already-rendered cards
    attachObserver();

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  const projects = [
    { Component: Riley, id: "riley" },
    { Component: AdidasMessi, id: "adidas-messi" },
    { Component: SamDenton, id: "sam-denton" },
    { Component: Ryland, id: "ryland" },
    { Component: AubitSound, id: "aubit-sound" },
    { Component: JohnWhite, id: "john-white" },
    { Component: BrandX, id: "brand-x" },
    { Component: KRPTK, id: "krptk" },
    { Component: PlatinumRoses, id: "platinum-roses" },
  ];

  return (
    <div id="projects" className="md:pt-16">
      <h2 className="py-5 flex justify-center text-5xl underline">
        project highlights
      </h2>
      <div
        ref={containerRef}
        id="project-highlights"
        className="flex flex-wrap justify-center xl:w-4/5 mx-auto gap-5"
      >
        <React.Suspense fallback={<div>Loading projects...</div>}>
          {projects.map(({ Component, id }) => (
            <Component key={id} id={id} />
          ))}
        </React.Suspense>
        <Outlet />
      </div>
    </div>
  );
};

export default ProjectHighlights;
