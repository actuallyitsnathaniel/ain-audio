import Disc from "./disc";

import React, { useState, memo } from "react";
import { motion } from "framer-motion";

const Discography = memo(({ children }: { children: JSX.Element[] }) => {
  const itemVariants = {
    visible: {
      opacity: 1,
      y: 0,
      transition: { type: "spring", stiffness: 300, damping: 24 },
    },
    hidden: { opacity: 0, y: 20, transition: { duration: 0.2 } },
  };

  const [expanded, setExpanded] = useState(-1);
  return (
    <div className="flex flex-col md:px-28">
      <div>
        {React.Children.toArray(children).some(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (child: any) =>
            child.props.releaseType === "single" ||
            child.props.releaseType === "ep"
        ) ? (
          <>
            <h2 className={"flex text-6xl italic justify-center p-5"}>
              singles / EPs
            </h2>
            <div className={"flex flex-row flex-wrap w-full justify-center"}>
              {React.Children.map(children, (child, i) => {
                if (
                  child.props.releaseType === "single" ||
                  child.props.releaseType === "ep"
                )
                  return (
                    <motion.div variants={itemVariants}>
                      {React.cloneElement(child, { expanded, setExpanded, i })}
                    </motion.div>
                  );
              })}
            </div>
          </>
        ) : null}
      </div>
      <div>
        {React.Children.toArray(children).some(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (child: any) => child.props.releaseType === "album"
        ) ? (
          <>
            <h2 className={"flex text-6xl italic justify-center p-5"}>
              albums
            </h2>
            <div className={"flex flex-row flex-wrap w-full justify-center"}>
              {React.Children.map(children, (child, i) => {
                if (child.props.releaseType === "album")
                  return (
                    <div>
                      {React.cloneElement(child, { expanded, setExpanded, i })}
                    </div>
                  );
              })}
            </div>
          </>
        ) : null}
      </div>
      <div>
        {React.Children.toArray(children).some(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (child: any) => child.props.releaseType === "general"
        ) ? (
          <>
            <div className={"flex flex-row flex-wrap w-full justify-center"}>
              {React.Children.map(children, (child, i) => {
                if (child.props.releaseType === "general")
                  return (
                    <div>
                      {React.cloneElement(child, { expanded, setExpanded, i })}
                    </div>
                  );
              })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
});

Discography.Disc = Disc;

export default Discography;
