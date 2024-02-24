import React, { useState } from "react";
import { PropTypes } from "prop-types";

import Disc from "./disc";

const Discography = ({ children }) => {
  const [expanded, setExpanded] = useState(-1);
  return (
    <div>
      <div
        className={"flex flex-wrap w-full md:w-11/12 md:mx-auto justify-center"}
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
