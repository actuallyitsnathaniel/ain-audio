import InstagramLogo from "./instagram-link";
import GmailLogo from "./gmail-link";
import SpotifyLink from "./spotify-link";
import AppleMusic from "./apple-music-link";

export const SocialLinks = () => {
  return (
    <div className="mb-2.5 transition-translate duration-100 hover:delay-150 flex justify-center md:pt-4 sm:h-full md:h-auto">
      <div
        className={`flex justify-center ${
          document.URL.includes("links") ? "hidden" : ""
        }`}
      >
        <SpotifyLink />
        <AppleMusic />
        <InstagramLogo />
        <GmailLogo />
      </div>
    </div>
  );
};
