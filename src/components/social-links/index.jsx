import { PropTypes } from "prop-types";

import InstagramLink from "./instagram-link";
import GmailLink from "./gmail-link";
import SpotifyLink from "./spotify-link";
import AppleMusic from "./apple-music-link";

export const SocialLinks = ({
  className,
  spotifyLink,
  appleMusicLink,
  instagramLink,
  gmailLink,
}) => {
  return (
    <div
      className={`mb-2.5 transition-all duration-150 hover:delay-150 flex justify-center sm:h-full md:h-auto ${className}`}
    >
      <div className={`flex justify-center`}>
        {spotifyLink && <SpotifyLink {...{ spotifyLink }} />}
        {appleMusicLink && <AppleMusic {...{ appleMusicLink }} />}
        {instagramLink && <InstagramLink {...{ instagramLink }} />}
        {gmailLink && <GmailLink {...{ gmailLink }} />}
      </div>
    </div>
  );
};

SocialLinks.propTypes = {
  className: PropTypes.string,
  spotifyLink: PropTypes.string,
  appleMusicLink: PropTypes.string,
  instagramLink: PropTypes.string,
  gmailLink: PropTypes.string,
};
