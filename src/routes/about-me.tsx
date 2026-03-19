import { motion } from "framer-motion";
import { fadeUp, stagger } from "../lib/animation";

const AboutMe = () => {
  // todo: add more pictures of myself!
  return (
    <div
      id="about-me"
      className="min-h-screen flex flex-col items-center justify-center"
    >
      <motion.div
        className="flex flex-col gap-6 w-full"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, margin: "-80px" }}
        variants={stagger}
      >
        <motion.h2
          className="p-5 flex justify-center text-5xl underline"
          variants={fadeUp}
        >
          about me
        </motion.h2>
        <motion.p
          className="w-5/6 md:w-auto lg:w-3/4 mx-auto text-justify text-lg md:px-24 lowercase"
          variants={fadeUp}
        >
          I&apos;m a music producer, sound designer, composer, arranger,
          songwriter, and recording artist. I&apos;ve been messing around with
          beats and sounds for over 12 years, blending digital and analog stuff to
          make sounds that are nostalgic, but still fresh. I love using sounds and
          tones from all sorts of gadgets, like computer processors and even smart
          ovens. You can hear my work all over the place—from small artists, big
          artists, even Adidas commercials. If I&apos;m not doing music, I&apos;m
          probably either writing code or playing video games. Feel free to poke
          around my projects——I&apos;m really proud of my portfolio so far and I
          love collaborating, so reach out if my stuff interests you!
        </motion.p>
      </motion.div>
    </div>
  );
};

export default AboutMe;
