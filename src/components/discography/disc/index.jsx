import { useState } from "react";
import { PropTypes } from "prop-types";

import MusicPlatformLinks from "./platform-links";

const Disc = ({
  i,
  className,
  appleMusicLink,
  spotifyLink,
  soundcloudLink,
  youtubeLink,
  album,
  artwork,
  title,
}) => {
  const [expanded, setExpanded] = useState(-1);

  const setActiveDisc = (i) => {
    if (i === expanded) {
      setExpanded(-1);
    } else {
      setExpanded(i);
    }
  };

  return (
    <div
      onClick={() => {
        setActiveDisc(i);
      }}
      className={`${className} transition-scale duration-100 text-8xl p-6 hover:scale-110 group`}
    >
      <div className={"h-[300px] w-[300px]"}>
        <MusicPlatformLinks
          className={`transition-all origin-content bg-black overflow-visible
          ${
            expanded === i
              ? "bg-opacity-50 backdrop-blur-md opacity-100 visible"
              : "invisible opacity-0 bg-opacity-0 backdrop-blur-none"
          }`}
          appleMusicLink={appleMusicLink}
          spotifyLink={spotifyLink}
          soundcloudLink={soundcloudLink}
          youtubeLink={youtubeLink}
          album={album}
        />
        <img height={"300px"} width={"300px"} src={artwork} alt={title} />
      </div>
      <div className="flex flex-row w-[300px] flex-wrap text-center justify-center transition-scale duration-100 origin-top text-xl pt-2 scale-0 group-hover:scale-90">
        {title}
      </div>
    </div>
  );
};

Disc.propTypes = {
  i: PropTypes.number,
  className: PropTypes.string,
  appleMusicLink: PropTypes.string,
  spotifyLink: PropTypes.string,
  soundcloudLink: PropTypes.string,
  youtubeLink: PropTypes.string,
  album: PropTypes.string,
  artwork: PropTypes.string,
  title: PropTypes.string,
};

export default Disc;
