import { useState } from "react";
import { SamDenton } from "./projects/sam-denton";

const Music = () => {
  const [expanded, setExpanded] = useState(-1);

  const HandleActiveArtist = (i) => {
    console.log(i);
    if (i == expanded) {
      setExpanded(-1);
    } else {
      setExpanded(i);
    }
  };

  return (
    // TODO: integrate modal effect, make artist page absolute.
    <div
      id="music"
      className="p-5 flex flex-col min-h-screen justify-center text-4xl"
    >
      <h1 className="text-4xl py-10">projects/music</h1>
      <SamDenton {...{ HandleActiveArtist, expanded }} />
    </div>
  );
};

export default Music;
