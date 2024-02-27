import Home from "./home";
import AboutMe from "./about-me";
import ProjectHighlights from "./music/projects";
import Press from "./press";

// import VideoBG from "../components/video-background";
import Footer from "/src/components/footer";
import { NavBar } from "/src/components/navbar";
import ScrollToHashElement from "/src/utilities/ScrollToHashElement";

const Root = () => {
  /**
   * TODO: desktop navbar to become icons?
   * NO. actually have one that can play all your stuff.
   * TODO: sideways scrollbar, style it like an ableton session
   */

  return (
    <div
      id="root"
      className="flex flex-wrap justify-center text-center flex-col font-light [&>*]:text-white"
    >
      {/* <VideoBG /> */}
      <ScrollToHashElement />
      <Home />
      <AboutMe />
      <ProjectHighlights />
      <Press />
      {/* <Connect /> */}
      <Footer />
      <NavBar />
    </div>
  );
};

export default Root;
