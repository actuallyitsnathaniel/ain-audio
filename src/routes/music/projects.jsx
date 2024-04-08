import React from "react";
import { Outlet } from "react-router-dom";

import { AdidasMessi } from "./projects/adidas-messi";
import { AubitSound } from "./projects/aubit";
import { BrandX } from "./projects/brand-x";
import { JohnWhite } from "./projects/john-white";
import { KRPTK } from "./projects/krptk";
import { PlatinumRoses } from "./projects/platinum-roses";
import { Riley } from "./projects/riley";
import { Ryland } from "./projects/ryland";
import { SamDenton } from "./projects/sam-denton";

const ProjectHighlights = () => {
  const projectChildren = [
    <Riley key={1} id="riley" />,
    <AdidasMessi key={2} id="adidas-messi" />,
    <SamDenton key={3} id="sam-denton" />,
    <Ryland key={4} id="ryland" />,
    <AubitSound key={5} id="aubit-sound" />,
    <JohnWhite key={6} id="john-white" />,
    <BrandX key={7} id="brand-x" />,
    <KRPTK key={8} id="krptk" />,
    <PlatinumRoses key={9} id="platinum-roses" />,
  ];

  return (
    <div id="projects" className="md:pt-16">
      <h1 className="py-5 flex justify-center text-5xl underline">
        project highlights
      </h1>
      <div
        id="project-highlights"
        className="flex flex-wrap justify-center xl:w-4/5 mx-auto"
      >
        {React.Children.map(projectChildren, (child, i) => {
          return React.cloneElement(child, {
            i,
          });
        })}
        <Outlet />
      </div>
    </div>
  );
};

export default ProjectHighlights;
