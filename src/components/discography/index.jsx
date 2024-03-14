import React, { useState } from "react";
import { PropTypes } from "prop-types";

import Disc from "./disc";

const Discography = ({ children }) => {
  const [expanded, setExpanded] = useState(-1);
  return (
    <div className="flex px-10 md:px-28 pb-10">
      <div
        className={
          "flex flex-wrap justify-center w-fit py-10 content-between gap-6 bg-gray-500 rounded-lg bg-opacity-25"
        }
      >
        {React.Children.map(children, (child, i) => {
          return React.cloneElement(child, { expanded, setExpanded, i });
        })}
      </div>
    </div>
  );
};

Discography.propTypes = {
  children: PropTypes.array,
};

Discography.Disc = Disc;

export default Discography;
