import { PropTypes } from "prop-types";
// Icons
import appleMusic from "/src/assets/images/icons/music-platforms/apple-music.svg";
import spotify from "/src/assets/images/icons/music-platforms/spotify.svg";
import soundcloud from "/src/assets/images/icons/music-platforms/soundcloud.svg";
import youtube from "/src/assets/images/icons/music-platforms/youtube.svg";
import tidal from "/src/assets/images/icons/music-platforms/tidal.svg";

const Link = ({ href, image }) => {
  return (
    <a
      href={href}
      className={`${!href && "hidden"}`}
      rel="noopener noreferrer"
      target="_blank"
    >
      <img
        className="transition-all duration-75 md:hover:scale-110"
        height={"75px"}
        width={"75px"}
        alt="music-link"
        src={image}
      />
    </a>
  );
};

const MusicPlatformLinks = ({
  className,
  spotifyLink,
  appleMusicLink,
  soundcloudLink,
  tidalLink,
  youtubeLink,
}) => {
  return (
    <div
      className={`fixed grid grid-cols-2 gap-2
      ${className} h-[305px] w-[305px] justify-items-center items-center -translate-x-1 -translate-y-1 p-4
      `}
    >
      {spotifyLink && <Link href={spotifyLink} image={spotify} />}
      {appleMusicLink && <Link href={appleMusicLink} image={appleMusic} />}
      {soundcloudLink && <Link href={soundcloudLink} image={soundcloud} />}
      {tidalLink && <Link href={tidalLink} image={tidal} />}
      {youtubeLink && <Link href={youtubeLink} image={youtube} />}
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
