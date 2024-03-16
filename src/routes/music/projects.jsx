import React, { useState } from "react";
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
    // console.log({ i });
    // console.log({ expanded });
    if (i == expanded) {
      setExpanded(-1);
    } else {
      setExpanded(parseInt(i));
    }
  };
  const [expanded, setExpanded] = useState(-1);

  const children = [
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
        id="projects"
        className="flex flex-wrap justify-center xl:w-4/5 mx-auto"
      >
        {React.Children.map(children, (child, i) => {
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
