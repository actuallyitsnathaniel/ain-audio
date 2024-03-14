import { PropTypes } from "prop-types";
import { useState } from "react";

export const ProfilePic = ({
  i,
  expanded,
  HandleActiveArtist,
  image,
  titleComponent,
}) => {
  return (
    <button
      onClick={() => HandleActiveArtist(i, expanded)}
      className="group appearance-none flex flex-col text-3xl mx-auto p-8 transition-transform duration-100 md:hover:scale-105 border-none"
    >
      <img
        src={image}
        id={i}
        alt="profile-pic-alt"
        className="transition-scale max-h-[300px] object-contain rounded-xl"
      />
      <div className="flex transition-translate duration-75 md:group-hover:translate-y-0.5 mx-auto">
        {titleComponent}
      </div>
    </button>
  );
};

export const Title = ({ artistName, subtitle }) => {
  return (
    <div className="py-3 justify-center w-full">
      <p className="flex justify-center text-2xl">{artistName}</p>
      <p id="desc" className="text-lg italic">
        {subtitle}
      </p>
    </div>
  );
};

export const Project = ({
  i,
  expanded,
  HandleActiveArtist,
  works,
  description,
  titleComponent,
}) => {
  const [truncateText, setTruncateText] = useState(true);
  return (
    <div
      id="project"
      className={`fixed top-0 left-0 z-[4] flex flex-col items-center text-white transition-all duration-100 ease-in-out bg-black bg-opacity-80 w-screen scroll- backdrop-blur-md ${
        expanded == i ? "scale-100 h-screen blur-none" : "scale-0 h-0 blur-lg"
      }`}
    >
      <ProjectsToggleButton {...{ expanded, HandleActiveArtist }} />
      <div
        id="projects-wrapper"
        className="pt-10 h-full overflow-y-scroll overscroll-contain"
      >
        {<h2 className="text-4xl py-6">{titleComponent}</h2>}
        <p
          onClick={() => setTruncateText(!truncateText)}
          className={`max-w-5xl mx-auto px-10 text-justify ${
            truncateText && "line-clamp-2 text-ellipsis overflow-hidden"
          }`}
        >
          {description ? (
            description
          ) : (
            <p className="text-center italic">
              still getting my words together for this project. be patient!
            </p>
          )}
        </p>

        {description && (
          <div
            className="p-6 items-center align-middle"
            onClick={() => setTruncateText(!truncateText)}
          >
            <span className="border border-spacing-10 p-3 pt-2 rounded-md border-white underline underline-offset-2 cursor-pointer italic">
              {truncateText ? "more" : "less"}
            </span>
          </div>
        )}

        {works}
      </div>
    </div>
  );
};

const ProjectsToggleButton = ({ i, expanded, HandleActiveArtist }) => {
  return (
    <button
      data-collapse-toggle="navbar"
      id="navbar-icon"
      type="button"
      className={`flex flex-col fixed top-3 left-2 m-3 z-[4] duration-200 translate-x-3`}
      aria-controls="navbar"
      aria-expanded="false"
      onClick={() => {
        HandleActiveArtist(i, expanded);
      }}
    >
      <span
        className={`flex w-12 h-1 mb-2.5 relative bg-white rounded-sm origin-top-left duration-200 ${
          expanded != i ? "rotate-45" : "rotate-0"
        }`}
      />
      <span
        className={`flex w-12 h-1 mb-2.5 relative bg-white rounded-sm origin-center duration-200 ${
          expanded != i
            ? "rotate-180 opacity-0 scale-0"
            : "rotate-0 scale-100 opacity-100"
        }`}
      />
      <span
        className={`flex w-12 h-1 mb-2.5 relative bg-white rounded-sm origin-bottom-left duration-200 ${
          expanded != i
            ? "-rotate-45 translate-y-[5px]"
            : "rotate-0 translate-y-0"
        }`}
      />
    </button>
  );
};

Title.propTypes = {
  artistName: PropTypes.string,
  subtitle: PropTypes.string,
};

ProfilePic.propTypes = {
  i: PropTypes.number,
  expanded: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
  image: PropTypes.string,
  titleComponent: PropTypes.object,
};

Project.propTypes = {
  i: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
  expanded: PropTypes.number,
  works: PropTypes.object,
  description: PropTypes.object,
  titleComponent: PropTypes.object,
};

ProjectsToggleButton.propTypes = {
  i: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
  expanded: PropTypes.number,
};
