import { useState } from "react";
import { SamDenton } from "./projects/sam-denton";
import { Ryland } from "./projects/ryland";

const Music = () => {
  // const [index, setIndex] = useState(-1);

  // const HandleActiveArtist = (i) => {
  //   console.log({ i });
  //   console.log({ index });
  //   if (i == index) {
  //     setIndex(-1);
  //   } else {
  //     setIndex(parseInt(i));
  //   }
  // };
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      id="music"
      className="p-5 flex flex-col min-h-screen justify-center text-4xl"
    >
      <h1 className="text-4xl py-10">projects/music</h1>
      <div id="projects" className="flex flex-wrap justify-around">
        {/* TODO: integrate socials for each artist, just under title
            TODO: add descriptions for each artist, under socials */}
        <SamDenton i={0} {...{ expanded, setExpanded }} />
        <Ryland i={1} {...{ expanded, setExpanded }} />
        {/* 
          TODO: literally the rest. go through projects PDF.
        */}
      </div>
    </div>
  );
};

export default Music;
