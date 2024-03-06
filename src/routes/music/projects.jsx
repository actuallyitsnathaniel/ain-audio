import { useState } from "react";
import { SamDenton } from "./projects/sam-denton";
import { Ryland } from "./projects/ryland";
import { Riley } from "./projects/riley";
import { JohnWhite } from "./projects/john-white";
import { BrandX } from "./projects/brand-x";
import { KRPTK } from "./projects/krptk";
import { PlatinumRoses } from "./projects/platinum-roses";
import { AubitSound } from "./projects/aubit";

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

  return (
    <div id="projects" className="md:pt-16">
      <h1 className="p-5 flex justify-center text-4xl">project highlights</h1>
      <div id="projects" className="flex flex-wrap justify-center">
        {/* TODO: integrate socials for each artist, just under title
            TODO: add descriptions for each artist, under socials */}
        <SamDenton i={0} {...{ expanded, HandleActiveArtist }} />
        <Ryland i={1} {...{ expanded, HandleActiveArtist }} />
        <AubitSound i={2} {...{ expanded, HandleActiveArtist }} />
        <JohnWhite i={3} {...{ expanded, HandleActiveArtist }} />
        {/** Will need to add hyperpop EP soon */}
        <Riley i={4} {...{ expanded, HandleActiveArtist }} />
        <BrandX i={5} {...{ expanded, HandleActiveArtist }} />
        <KRPTK i={6} {...{ expanded, HandleActiveArtist }} />
        <PlatinumRoses i={7} {...{ expanded, HandleActiveArtist }} />

        {/* 
          TODO: literally the rest. go through projects PDF.
          - AubitSound
            - apply links to rest of projects
          - PlatinumRoses
            - LINKS!!!
          - ADIDAS!!! * ask jake about stuff here.
        */}
      </div>
    </div>
  );
};

export default ProjectHighlights;
