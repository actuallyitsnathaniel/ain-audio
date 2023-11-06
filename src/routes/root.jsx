import Home from "./home";
import AboutMe from "./about-me";
import Footer from "../components/footer";
import { NavBar } from "../components/navbar";
import ScrollToHashElement from "../utilities/ScrollToHashElement";

const Root = () => {
  return (
    <div
      id="root"
      className="flex max-w-screen h-screen justify-center text-center align-middle"
    >
      <div id="root-wrapper">
        <Home />
        <AboutMe />
        {/* <Music /> */}
        {/* <Connect /> */}
        <Footer />
        <ScrollToHashElement />
      </div>
      <NavBar />
    </div>
  );
};

export default Root;
