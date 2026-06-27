import { motion } from "framer-motion";
import { stagger } from "../lib/animation";

// ponytail: pure-variant loop — no timer/state to clean up. repeatType "reverse"
// mirrors the in-animation as the out-animation; repeatDelay is the 0.75s dwell.
const char = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.25, 0.1, 0.25, 1] as const,
      repeat: Infinity,
      repeatType: "reverse" as const,
      repeatDelay: 0.75,
    },
  },
};

const Loader = () => (
  <motion.div
    className="flex items-center justify-center min-h-screen text-white bg-black"
    initial="hidden"
    animate="visible"
    variants={stagger}
    aria-label="Loading"
  >
    {"Loading...".split("").map((c, i) => (
      <motion.span key={i} variants={char} style={{ whiteSpace: "pre" }}>
        {c}
      </motion.span>
    ))}
  </motion.div>
);

export default Loader;
