import React from "react";
import { PropTypes } from "prop-types";

import Disc from "./disc";

const Discography = ({ children }) => {
  return (
    <div>
      <div
        className={"flex flex-wrap w-full md:w-5/6 md:mx-auto justify-center"}
      >
        {React.Children.map(children, (child) => {
          return React.cloneElement(child);
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
