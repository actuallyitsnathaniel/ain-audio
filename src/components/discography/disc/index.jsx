import { PropTypes } from "prop-types";

import MusicPlatformLinks from "./platform-links";

const Disc = ({
  expanded,
  setExpanded,
  i,
  className,
  appleMusicLink,
  spotifyLink,
  soundcloudLink,
  tidalLink,
  youtubeLink,
  webLink,
  album,
  artwork,
  title,
}) => {
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
      onMouseLeave={() => {
        setActiveDisc(-1);
      }}
      onMouseEnter={() => setActiveDisc(i)}
      className={`${className} transition-scale duration-100 text-8xl py-6 md:px-6 md:hover:scale-110 group`}
    >
      <div className={"relative h-[300px] w-[300px]"}>
        <MusicPlatformLinks
          className={`transition-all origin-content bg-black
          ${
            expanded === i
              ? "bg-opacity-50 backdrop-blur-md opacity-100 visible"
              : "invisible opacity-0 bg-opacity-0 backdrop-blur-none"
          }`}
          {...{
            appleMusicLink,
            spotifyLink,
            soundcloudLink,
            tidalLink,
            youtubeLink,
            webLink,
            album,
          }}
        />
        <img height={"300px"} width={"300px"} src={artwork} alt={title} />
      </div>
      <div className="flex flex-row w-[300px] flex-wrap text-center justify-center transition-scale duration-100 origin-top text-lg pt-2 md:invisible md:group-hover:visible md:scale-0 md:group-hover:scale-90">
        {title}
      </div>
    </div>
  );
};

Disc.propTypes = {
  expanded: PropTypes.number,
  setExpanded: PropTypes.func,
  i: PropTypes.number,
  className: PropTypes.string,
  appleMusicLink: PropTypes.string,
  spotifyLink: PropTypes.string,
  soundcloudLink: PropTypes.string,
  tidalLink: PropTypes.string,
  youtubeLink: PropTypes.string,
  webLink: PropTypes.string,
  album: PropTypes.string,
  artwork: PropTypes.string,
  title: PropTypes.string,
};

export default Disc;
