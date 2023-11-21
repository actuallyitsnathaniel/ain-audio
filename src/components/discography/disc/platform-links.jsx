import { PropTypes } from "prop-types";
// Icons
import appleMusic from "../../../assets/images/icons/music-platforms/apple-music.svg";
import spotify from "../../../assets/images/icons/music-platforms/spotify.svg";
import soundcloud from "../../../assets/images/icons/music-platforms/soundcloud.svg";
import youtube from "../../../assets/images/icons/music-platforms/youtube.svg";
import tidal from "../../../assets/images/icons/music-platforms/tidal.svg";

const Link = ({ href, image }) => {
  return (
    <a
      href={href}
      className={`${href === "" && "hidden"}`}
      rel="noopener noreferrer"
      target="_blank"
    >
      <img
        className="transition-all duration-75 md:hover:scale-110"
        height={"75px"}
        alt="music-link"
        src={image}
      />
    </a>
  );
};

const MusicPlatformLinks = ({
  className,
  width,
  spotifyLink,
  appleMusicLink,
  soundcloudLink,
  tidalLink,
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
      <Link href={spotifyLink} image={spotify} />
      <Link href={appleMusicLink} image={appleMusic} />
      <Link href={soundcloudLink} image={soundcloud} />
      <Link href={tidalLink} image={tidal} />
      <Link href={youtubeLink} image={youtube} />
    </div>
  );
};

Link.propTypes = {
  href: PropTypes.string,
  image: PropTypes.string,
};

MusicPlatformLinks.propTypes = {
  className: PropTypes.string,
  width: PropTypes.string,
  spotifyLink: PropTypes.string,
  appleMusicLink: PropTypes.string,
  soundcloudLink: PropTypes.string,
  tidalLink: PropTypes.string,
  youtubeLink: PropTypes.string,
};

export default MusicPlatformLinks;
