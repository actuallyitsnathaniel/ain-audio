import Home from "./home";
import AboutMe from "./about-me";
import Music from "./music/music";
import Press from "./press";

import Footer from "../components/footer";
import { NavBar } from "../components/navbar";
import ScrollToHashElement from "../utilities/ScrollToHashElement";

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
      <Home />
      <AboutMe />
      <Music />
      <Press />
      {/* <Connect /> */}
      <Footer />
      <ScrollToHashElement />
      <NavBar />
    </div>
  );
};

export default Root;
