import { motion, useScroll, useTransform } from "framer-motion";
import profilePic from "/src/assets/images/ain-pfp.jpeg";
import TypeIt from "typeit-react";

import { SocialLinks } from "../components/social-links";
import { fadeUp, stagger } from "../lib/animation";

const Home = () => {
  const { scrollYProgress } = useScroll();
  const scrollOpacity = useTransform(scrollYProgress, [0.85, 1], [1, 0]);

  return (
    <div
      id="home"
      className="relative flex min-h-screen flex-col justify-center"
    >
      <motion.div
        className="flex flex-col items-center gap-6"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        <motion.h1 className="pt-20 mx-auto" variants={fadeUp}>
          <SocialLinks
            className={""}
            spotifyLink={
              "https://open.spotify.com/playlist/5YIJBk2ASIJqbd07gyOGdY?si=1cf595b570c24bf0"
            }
            youtubeLink={"https://www.youtube.com/@actuallyitsnathaniel"}
            instagramLink={"https://instagram.com/actuallyitsnathaniel"}
            gmailLink={"mailto:nathanielrbowman@gmail.com"}
          />
          <span className="flex-nowrap text-3xl font-light flex mb-7 tracking-wide justify-center mx-auto">
            <TypeIt options={{ speed: 55, cursorChar: "_" }}>
              @actuallyitsnathaniel
            </TypeIt>
          </span>
        </motion.h1>
        <motion.div className="flex h-1/3 justify-center" variants={fadeUp}>
          <img
            src={profilePic}
            className="rounded-full max-h-80"
            alt="Nathaniel Bowman, music producer and audio engineer"
          />
        </motion.div>
      </motion.div>

      <motion.div
        className="fixed bottom-8 left-8 flex flex-col items-center gap-2 z-50"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2, duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
        style={{ opacity: scrollOpacity }}
      >
        <motion.div
          className="w-px h-10 bg-white/60 origin-top"
          animate={{ scaleY: [0, 1, 0] }}
          transition={{
            duration: 1.6,
            repeat: Infinity,
            repeatDelay: 0.4,
            ease: "easeInOut",
          }}
        />
        <span className="text-[10px] tracking-[0.25em] text-white/60 uppercase">
          Scroll
        </span>
      </motion.div>
    </div>
  );
};

export default Home;
