import InstagramLink from "./instagram-link";
import GmailLink from "./gmail-link";
import SpotifyLink from "./spotify-link";
import AppleMusic from "./apple-music-link";
import YoutubeLink from "./youtube-link";

export const SocialLinks = ({
  className,
  spotifyLink,
  appleMusicLink,
  instagramLink,
  gmailLink,
  youtubeLink,
}: {
  className: string;
  spotifyLink?: string;
  appleMusicLink?: string;
  instagramLink: string;
  gmailLink: string;
  youtubeLink?: string;
}) => {
  return (
    <div
      className={`mb-2.5 transition-all duration-150 hover:delay-150 flex justify-center sm:h-full md:h-auto ${className}`}
    >
      <div className={`flex justify-center`}>
        {spotifyLink && <SpotifyLink href={spotifyLink} />}
        {youtubeLink && <YoutubeLink href={youtubeLink} />}
        {appleMusicLink && <AppleMusic href={appleMusicLink} />}
        {instagramLink && <InstagramLink href={instagramLink} />}
        {gmailLink && <GmailLink href={gmailLink} />}
      </div>
    </div>
  );
};
