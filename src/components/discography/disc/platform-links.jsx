import { PropTypes } from "prop-types";
// Icons
import appleMusic from "../../../assets/images/icons/music-platforms/apple-music.svg";
import spotify from "../../../assets/images/icons/music-platforms/spotify.svg";
import soundcloud from "../../../assets/images/icons/music-platforms/soundcloud.svg";
import youtube from "../../../assets/images/icons/music-platforms/youtube.svg";

const MusicPlatformLinks = ({
  className,
  width,
  spotifyLink,
  appleMusicLink,
  soundcloudLink,
  youtubeLink,
}) => {
  return (
    <div
      className={`absolute grid grid-cols-2 
      ${className} h-[305px]  ${
        width ? width : "w-[305px]"
      } justify-items-center items-center -translate-x-1 -translate-y-1 p-4
      `}
    >
      <a
        href={spotifyLink}
        className={`${spotifyLink === "" && "hidden"}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        <img
          className="transition-all duration-75 hover:scale-110"
          height={"75px"}
          alt="spotify-link"
          src={spotify}
        />
      </a>

      <a
        href={appleMusicLink}
        className={`${appleMusicLink === "" && "hidden"}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        <img
          className="transition-all duration-75 hover:scale-110"
          height={"75px"}
          alt="apple-music-link"
          src={appleMusic}
        />
      </a>

      <a
        href={soundcloudLink}
        className={`${soundcloudLink === "" && "hidden"}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        <img
          className={`transition-all duration-75 scale-110 hover:scale-125`}
          height={"75px"}
          alt="soundcloud-link"
          src={soundcloud}
        />
      </a>

      <a
        href={youtubeLink}
        className={`${youtubeLink === "" && "hidden"}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        <img
          className="transition-all duration-75 hover:scale-110"
          height={"75px"}
          alt="youtube-link"
          src={youtube}
        />
      </a>
    </div>
  );
};

MusicPlatformLinks.propTypes = {
  className: PropTypes.string,
  width: PropTypes.string,
  spotifyLink: PropTypes.string,
  appleMusicLink: PropTypes.string,
  soundcloudLink: PropTypes.string,
  youtubeLink: PropTypes.string,
};

export default MusicPlatformLinks;
