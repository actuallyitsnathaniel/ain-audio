// Icons
import appleMusic from "/src/assets/images/icons/music-platforms/apple-music.svg";
import spotify from "/src/assets/images/icons/music-platforms/spotify.svg";
import soundcloud from "/src/assets/images/icons/music-platforms/soundcloud.svg";
import youtube from "/src/assets/images/icons/music-platforms/youtube.svg";
import tidal from "/src/assets/images/icons/music-platforms/tidal.svg";
import hyperlinkIcon from "/src/assets/images/icons/shop-icon.svg";
import { motion, AnimatePresence } from "framer-motion";

const iconVariant = {
  hidden: { opacity: 0, y: 6 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.06,
      duration: 0.25,
      ease: [0.25, 0.1, 0.25, 1] as const,
    },
  }),
  exit: { opacity: 0, y: 6, transition: { duration: 0.15 } },
};

const Link = ({
  href,
  image,
  index,
}: {
  href: string;
  image: string;
  index: number;
}) => (
  <motion.a
    href={href}
    className="flex p-4"
    rel="noopener noreferrer"
    target="_blank"
    custom={index}
    variants={iconVariant}
    initial="hidden"
    animate="visible"
    exit="exit"
  >
    <img
      className="transition-all duration-75 md:hover:scale-110"
      height="75px"
      width="75px"
      alt="music-link"
      src={image}
    />
  </motion.a>
);

export type MusicPlatformLinksType = {
  className: string;
  width?: string;
  spotifyLink?: string;
  appleMusicLink?: string;
  soundcloudLink?: string;
  tidalLink?: string;
  webLink?: string;
  youtubeLink?: string;
  focused?: boolean;
};

const MusicPlatformLinks = ({
  className,
  spotifyLink,
  appleMusicLink,
  soundcloudLink,
  tidalLink,
  youtubeLink,
  webLink,
  focused = false,
}: MusicPlatformLinksType) => {
  const links = [
    spotifyLink && { href: spotifyLink, image: spotify },
    appleMusicLink && { href: appleMusicLink, image: appleMusic },
    soundcloudLink && { href: soundcloudLink, image: soundcloud },
    tidalLink && { href: tidalLink, image: tidal },
    youtubeLink && { href: youtubeLink, image: youtube },
    webLink && { href: webLink, image: hyperlinkIcon },
  ].filter(Boolean) as { href: string; image: string }[];

  return (
    <div
      className={`absolute flex flex-wrap justify-around ${className} h-72 w-72 items-center`}
    >
      <AnimatePresence>
        {focused &&
          links.map((link, i) => (
            <Link key={link.href} href={link.href} image={link.image} index={i} />
          ))}
      </AnimatePresence>
    </div>
  );
};

export default MusicPlatformLinks;
