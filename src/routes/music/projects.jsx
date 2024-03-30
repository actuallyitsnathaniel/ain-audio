import React from "react";
import { SamDenton } from "./projects/sam-denton";
import { Ryland } from "./projects/ryland";
import { Riley } from "./projects/riley";
import { JohnWhite } from "./projects/john-white";
import { BrandX } from "./projects/brand-x";
import { KRPTK } from "./projects/krptk";
import { PlatinumRoses } from "./projects/platinum-roses";
import { AubitSound } from "./projects/aubit";
import { AdidasMessi } from "./projects/adidas-messi";

const ProjectHighlights = () => {
  const HandleActiveArtist = (i, expanded) => {
    if (i == expanded) {
      setExpanded(-1);
    } else {
      setExpanded(parseInt(i));
    }
  };
  const [expanded, setExpanded] = React.useState(-1);

  const projectChildren = [
    <Riley key="riley" />,
    <AdidasMessi key="adidas-messi" />,
    <SamDenton key="sam-denton" />,
    <Ryland key="ryland" />,
    <AubitSound key="aubit-sound" />,
    <JohnWhite key="john-white" />,
    <BrandX key="brand-x" />,
    <KRPTK key="krptk" />,
    <PlatinumRoses key="platinum-roses" />,
  ];

  return (
    <div id="projects" className="md:pt-16">
      <h1 className="py-5 flex flex-wrap justify-center text-5xl underline">
        project highlights
      </h1>
      <div
        id="project-highlights"
        className="flex flex-wrap justify-center xl:w-4/5 mx-auto"
      >
        {React.Children.map(projectChildren, (child, i) => {
          return React.cloneElement(child, {
            expanded,
            setExpanded,
            HandleActiveArtist,
            i,
          });
        })}
      </div>
    </div>
  );
};

export default ProjectHighlights;
