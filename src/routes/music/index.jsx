import { useState } from "react";
import { SamDenton } from "./projects/sam-denton";

const Music = () => {
  const [index, setIndex] = useState(-1);

  const HandleActiveArtist = (i) => {
    console.log({ i });
    console.log({ index });
    if (i == index) {
      setIndex(-1);
    } else {
      setIndex(i);
    }
  };

  return (
    // TODO: integrate modal effect, make artist page absolute.
    <div
      id="music"
      className="p-5 flex flex-col min-h-screen justify-center text-4xl"
    >
      <h1 className="text-4xl py-10">projects/music</h1>
      <SamDenton {...{ HandleActiveArtist, index }} i={0} />
    </div>
  );
};

export default Music;
