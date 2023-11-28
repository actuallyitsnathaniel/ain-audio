import { useState } from "react";
import { SamDenton } from "./projects/sam-denton";
import { Ryland } from "./projects/ryland";
import { Riley } from "./projects/riley";

const Music = () => {
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
    <div
      id="music"
      className="p-5 flex flex-col min-h-screen justify-center text-4xl"
    >
      <h1 className="text-4xl py-10">projects/music</h1>
      <div
        id="projects"
        className="flex flex-wrap justify-around flex-col md:flex-row"
      >
        {/* TODO: integrate socials for each artist, just under title
            TODO: add descriptions for each artist, under socials */}
        <SamDenton i={0} {...{ expanded, HandleActiveArtist }} />
        <Ryland i={1} {...{ expanded, HandleActiveArtist }} />
        <Riley i={2} {...{ expanded, HandleActiveArtist }} />
        {/* 
          TODO: literally the rest. go through projects PDF.
        */}
      </div>
    </div>
  );
};

export default Music;
