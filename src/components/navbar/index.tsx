import { useState, useEffect, SetStateAction, Dispatch } from "react";

import { NavItem } from "./nav-item";
import { MobileNavButton } from "./mobile-nav-button";

const NavList = () => {
  return (
    <>
      <NavItem text="Home" link={`#home`} />
      <NavItem text="Projects" link={`#projects`} />
      <NavItem text="Press" link={`#press`} />
    </>
  );
};

const DesktopNav = () => {
  return (
    <nav className="transition-transform duration-100 fixed top-0 left-0 flex whitespace-nowrap text-2xl animate-appear-slow lowercase mb-12 bg-gradient-to-b from-black to-transparent">
      <ul className="flex transition-transform duration-100 text-center flex-wrap flex-col md:flex-row py-4 w-screen justify-evenly">
        <NavList />
      </ul>
    </nav>
  );
};

const MobileNav = ({
  expanded,
  setExpanded,
}: {
  expanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
}) => {
  return (
    <nav
      className={`fixed top-0 left-0 flex whitespace-nowrap text-2xl animate-appear-slow `}
    >
      <div
        className={`fixed origin-left transition-transform duration-200 flex flex-col backdrop-blur-lg bg-black/60 h-screen w-screen ${
          expanded ? "translate-x-[0%]" : "translate-x-[-100%]"
        }`}
      >
        <ul className="flex flex-col h-[90%] justify-evenly text-center">
          <NavList />
        </ul>
      </div>
      <MobileNavButton {...{ expanded, setExpanded }} />
    </nav>
  );
};

export const NavBar = () => {
  const [windowDimension, setWindowDimension] = useState(window.innerWidth);
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
  const isMobile = windowDimension <= 768;

  return isMobile ? (
    <>
      <div
        className={`animate-appear fixed h-screen brightness-80 bg-gradient-to-tr from-transparent via-transparent to-emerald-950 ${
          !expanded && "hidden"
        }`}
      />
      <MobileNav {...{ expanded, setExpanded }} />
    </>
  ) : (
    <DesktopNav />
  );
};
