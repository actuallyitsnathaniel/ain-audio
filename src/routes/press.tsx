import { motion } from "framer-motion";
import { PressLink } from "../components/press-link";
import { fadeUp, stagger } from "../lib/animation";

const Press = () => {
  return (
    <div
      id="press"
      className="min-h-screen flex flex-col items-center justify-center p-10"
    >
      <motion.div
        className="flex flex-col items-center gap-10 w-full"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, margin: "-80px" }}
        variants={stagger}
      >
        <motion.h2
          className="py-5 flex justify-center text-5xl underline"
          variants={fadeUp}
        >
          press
        </motion.h2>
        <div className="flex flex-wrap justify-center gap-10">
          <motion.div variants={fadeUp}>
            <PressLink
              href={
                "https://voyagela.com/interview/conversations-with-nate-bowman/"
              }
              title={"Conversations with Nate Bowman"}
              subtitle={"Write-up by Voyage LA"}
            />
          </motion.div>
          <motion.div variants={fadeUp}>
            <PressLink
              href={
                "https://shoutoutla.com/meet-nathaniel-bowman-software-audio-engineer/"
              }
              title={"Meet Nathaniel Bowman | Software & Audio Engineer"}
              subtitle={"write-up by Shoutout LA"}
            />
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
};

export default Press;
