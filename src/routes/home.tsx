import { motion } from "framer-motion";
import profilePic from "/src/assets/images/ain-pfp.jpeg";
import TypeIt from "typeit-react";

import { SocialLinks } from "../components/social-links";
import { fadeUp, stagger } from "../lib/animation";

const Home = () => {
  return (
    <div id="home" className="flex min-h-screen flex-col justify-center">
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
          <span className="flex-nowrap text-3xl font-light flex mb-7 justify-center mx-auto">
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
    </div>
  );
};

export default Home;
