import React, { lazy, Suspense } from "react";
import { useParams, Link } from "react-router-dom";
import { NavBar } from "../../components/navbar";
import VideoBG from "../../components/video-background";
import Footer from "../../components/footer";

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
      <div className="flex flex-wrap flex-col w-screen justify-center text-center font-light [&>*]:text-white content-between gap-10 min-h-screen">
        <VideoBG />
        <div className="pt-8 px-4">
          <Link
            to="/#projects"
            className="inline-flex items-center text-white/70 hover:text-white transition-colors mb-8"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Projects
          </Link>
        </div>
        <Suspense fallback={<div className="text-white">Loading project...</div>}>
          <ProjectComponent id={projectId!} isStandalone={true} />
        </Suspense>
        <Footer />
        <NavBar />
      </div>
    </>
  );
};

export default ProjectPage;
