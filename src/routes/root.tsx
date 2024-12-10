import Home from "./home";
import ProjectHighlights from "./music/projects";
import Press from "./press";

import VideoBG from "../components/video-background";
import Footer from "../components/footer";
import { NavBar } from "../components/navbar";
import ScrollToHashElement from "../utilities/ScrollToHashElement";

const Root = () => {
  return (
    <div
      id="root"
      className="flex flex-wrap flex-col w-screen justify-center text-center font-light [&>*]:text-white content-between gap-10"
    >
      <VideoBG />
      <ScrollToHashElement />
      <Home />
      <ProjectHighlights />
      <Press />
      <Footer />
      <NavBar />
    </div>
  );
};

export default Root;
