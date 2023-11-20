import { useState, useEffect } from "react";
import { PropTypes } from "prop-types";

import { NavItem } from "./nav-item";
import { MobileNavButton } from "./mobile-nav-button";

const DesktopNav = () => {
  return (
    <nav className="transition-transform duration-100 fixed top-0 left-0 flex whitespace-nowrap text-2xl animate-appear-slow lowercase">
      <ul className="flex transition-transform duration-100 text-center flex-wrap flex-col md:flex-row py-4 w-screen justify-evenly">
        <NavItem text={`Home`} link={`#home`} />
        <NavItem text="About Me" link={`#about-me`} />
        <NavItem text="Music" link={`#music`} />
        {/* <NavItem text="Connect" link={`#connect`} /> */}
        <NavItem text="Press" link={`#press`} />
      </ul>
    </nav>
  );
};

const MobileNav = ({ expanded, setExpanded }) => {
  return (
    <nav
      className={`fixed top-0 left-0 flex whitespace-nowrap text-2xl animate-appear-slow `}
    >
      <div
        className={`fixed origin-left transition-transform duration-200 flex flex-col bg-black/60 h-screen w-screen ${
          expanded ? "translate-x-[0%]" : "translate-x-[-100%]"
        }`}
      >
        <ul className="flex flex-col h-[90%] justify-evenly text-center backdrop-blur-lg">
          <NavItem text="Home" link={`#home`} setExpanded={setExpanded} />
          <NavItem
            text="About Me"
            link={`#about-me`}
            setExpanded={setExpanded}
          />
          <NavItem text="Music" link={`#music`} setExpanded={setExpanded} />
          <NavItem text="Connect" link={`#connect`} setExpanded={setExpanded} />
          <NavItem text="Press" link={`#press`} setExpanded={setExpanded} />
        </ul>
      </div>
      <MobileNavButton type="browser" {...{ expanded, setExpanded }} />
    </nav>
  );
};

MobileNav.propTypes = {
  setExpanded: PropTypes.func,
  expanded: PropTypes.bool,
};

export const NavBar = () => {
  const [windowDimension, setWindowDimension] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setWindowDimension(window.innerWidth);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setWindowDimension(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const isMobile = windowDimension <= 640;

  return isMobile ? (
    <div className="">
      <div
        className={`fixed transition-all duration-100 h-screen brightness-80 bg-gradient-to-tr from-transparent via-transparent to-emerald-950 ${
          !expanded && "hidden"
        }`}
      />
      <MobileNav {...{ expanded, setExpanded }} />
    </div>
  ) : (
    <DesktopNav />
  );
};
