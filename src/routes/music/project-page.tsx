import React, { lazy, Suspense, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { NavBar } from "../../components/navbar";
import VideoBG from "../../components/video-background";
import Footer from "../../components/footer";

const pageVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

const ProjectSkeleton = () => (
  <div className="w-full max-w-5xl mx-auto px-4 animate-pulse">
    {/* Profile image placeholder */}
    <div className="flex flex-col items-center p-8 gap-4">
      <div className="h-64 w-64 rounded-xl bg-white/10" />
      <div className="h-6 w-32 rounded bg-white/10" />
      <div className="h-4 w-20 rounded bg-white/10" />
    </div>
    {/* Description placeholder */}
    <div className="px-6 space-y-3">
      <div className="h-4 rounded bg-white/10 w-full" />
      <div className="h-4 rounded bg-white/10 w-5/6" />
    </div>
    {/* Disc grid placeholder */}
    <div className="mt-10 flex flex-wrap gap-6 justify-center">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-72 w-72 rounded-xl bg-white/10" />
      ))}
    </div>
  </div>
);

const Riley = lazy(() => import("./projects/riley").then(m => ({ default: m.Riley })));
const AdidasMessi = lazy(() => import("./projects/adidas-messi").then(m => ({ default: m.AdidasMessi })));
const SamDenton = lazy(() => import("./projects/sam-denton").then(m => ({ default: m.SamDenton })));
const Ryland = lazy(() => import("./projects/ryland").then(m => ({ default: m.Ryland })));
const AubitSound = lazy(() => import("./projects/aubit").then(m => ({ default: m.AubitSound })));
const JohnWhite = lazy(() => import("./projects/john-white").then(m => ({ default: m.JohnWhite })));
const BrandX = lazy(() => import("./projects/brand-x").then(m => ({ default: m.BrandX })));
const KRPTK = lazy(() => import("./projects/krptk").then(m => ({ default: m.KRPTK })));
const PlatinumRoses = lazy(() => import("./projects/platinum-roses").then(m => ({ default: m.PlatinumRoses })));

const projectMap: Record<string, React.LazyExoticComponent<React.ComponentType<{ id: string; isStandalone?: boolean }>>> = {
  "riley": Riley,
  "adidas-messi": AdidasMessi,
  "sam-denton": SamDenton,
  "ryland": Ryland,
  "aubit-sound": AubitSound,
  "john-white": JohnWhite,
  "brand-x": BrandX,
  "krptk": KRPTK,
  "platinum-roses": PlatinumRoses,
};

const ProjectPage = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const ProjectComponent = projectId ? projectMap[projectId] : null;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [projectId]);

  if (!ProjectComponent) {
    return (
      <div className="flex flex-col min-h-screen items-center justify-center text-white">
        <h1 className="text-4xl mb-4">Project Not Found</h1>
        <Link to="/" className="text-blue-400 hover:underline">
          Return to Home
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col w-full text-center font-light [&>*]:text-white gap-10 min-h-screen">
        <VideoBG />
        <motion.div
          className="w-full"
          variants={pageVariants}
          initial="hidden"
          animate="visible"
        >
          <div className="pt-24 px-4 w-full max-w-5xl mx-auto text-left">
            <Link
              to="/#projects"
              className="inline-flex items-center text-white/70 hover:text-white transition-colors mb-8 focus:outline-none focus-visible:underline focus-visible:decoration-white focus-visible:underline-offset-4"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Projects
            </Link>
          </div>
          <Suspense fallback={<ProjectSkeleton />}>
            <div className="w-full">
              <ProjectComponent id={projectId!} isStandalone={true} />
            </div>
          </Suspense>
        </motion.div>
        <Footer />
        <NavBar />
      </div>
    </>
  );
};

export default ProjectPage;
