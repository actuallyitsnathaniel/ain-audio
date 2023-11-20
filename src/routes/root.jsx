import Home from "./home";
import AboutMe from "./about-me";
import Music from "./music";
import Press from "./press";

import Footer from "../components/footer";
import { NavBar } from "../components/navbar";
import ScrollToHashElement from "../utilities/ScrollToHashElement";

const Root = () => {
  /**
   *
   * TODO: desktop navbar to become icons?
   * NO. actually have one that can play all your stuff.
   * TODO: sideways scrollbar, style it like an ableton session
   */

  /**
   * TODO: favicon to be "@in"
   * TODO: mobile navbar check
   */
  return (
    <div id="root" className="flex justify-center text-center">
      <div id="root-wrapper">
        <Home />
        <AboutMe />
        <Music />
        <Press />
        {/* <Connect /> */}
        <Footer />
        <ScrollToHashElement />
      </div>
      <NavBar />
    </div>
  );
};

export default Root;
