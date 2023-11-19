import { PropTypes } from "prop-types";

import InstagramLogo from "./instagram-link";
import GmailLogo from "./gmail-link";
import SpotifyLink from "./spotify-link";
import AppleMusic from "./apple-music-link";

export const SocialLinks = ({ className }) => {
  return (
    <div
      className={`mb-2.5 transition-all duration-150 hover:delay-150 flex justify-center sm:h-full md:h-auto ${className}`}
    >
      <div className={`flex justify-center`}>
        <SpotifyLink />
        <AppleMusic />
        <InstagramLogo />
        <GmailLogo />
      </div>
    </div>
  );
};

SocialLinks.propTypes = {
  className: PropTypes.string,
};
