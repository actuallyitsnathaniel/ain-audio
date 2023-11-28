import { PropTypes } from "prop-types";
import dontPretend from "../../../assets/images/projects/brandx/dont-pretend.png";
import tomsDinerCover from "../../../assets/images/projects/brandx/toms-diner-cover.png";

// eslint-disable-next-line no-unused-vars
export const BrandX = ({ i, expanded, HandleActiveArtist }) => {
  return (
    <div id="brand-x">
      {/* 
     TODO: put in 'NORML', popfest, and 'mudo' stuff
    
    */}
    </div>
  );
};

BrandX.propTypes = {
  i: PropTypes.number,
  expanded: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
};
