import { PropTypes } from "prop-types";

export const ProfilePic = ({
  i,
  expanded,
  setExpanded,
  image,
  titleComponent,
}) => {
  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="appearance-none flex flex-col text-3xl mx-auto p-4"
    >
      <img
        src={image}
        id={i}
        alt="profile-pic-alt"
        className="max-h-[300px] object-contain rounded-xl"
      />
      {titleComponent}
    </button>
  );
};

export const Title = ({ artistName, subtitle }) => {
  return (
    <>
      <p className="flex justify-center w-full">{artistName}</p>
      <p id="desc" className="text-xl italic w-full justify-center">
        {subtitle}
      </p>
    </>
  );
};

export const Project = ({
  expanded,
  setExpanded,
  discography,
  titleComponent,
}) => {
  return (
    <div
      id="projects"
      className={`fixed top-0 left-0 z-[4] flex flex-col items-center text-white transition-all duration-100 ease-in-out bg-black bg-opacity-75 backdrop-blur-md ${
        expanded ? "scale-100 h-screen blur-none" : "scale-0 h-0 blur-lg"
      }`}
    >
      <ProjectsToggleButton {...{ expanded, setExpanded }} />
      <div
        id="projects-wrapper"
        className="pt-10 h-full overflow-y-scroll overscroll-contain"
      >
        {titleComponent}
        {discography}
      </div>
    </div>
  );
};

const ProjectsToggleButton = ({ expanded, setExpanded }) => {
  return (
    <button
      data-collapse-toggle="navbar"
      id="navbar-icon"
      type="button"
      className={`flex flex-col fixed top-3 left-2 m-3 z-[4] duration-200 translate-x-3`}
      aria-controls="navbar"
      aria-expanded="false"
      onClick={() => {
        setExpanded(!expanded);
      }}
    >
      <span
        className={`flex w-12 h-1 mb-2.5 relative bg-white rounded-sm origin-top-left duration-200 ${
          expanded ? "rotate-45" : "rotate-0"
        }`}
      />
      <span
        className={`flex w-12 h-1 mb-2.5 relative bg-white rounded-sm origin-center duration-200 ${
          expanded
            ? "rotate-180 opacity-0 scale-0"
            : "rotate-0 scale-100 opacity-100"
        }`}
      />
      <span
        className={`flex w-12 h-1 mb-2.5 relative bg-white rounded-sm origin-bottom-left duration-200 ${
          expanded ? "-rotate-45 translate-y-[5px]" : "rotate-0 translate-y-0"
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
  expanded: PropTypes.bool,
  setExpanded: PropTypes.func,
  image: PropTypes.string,
  titleComponent: PropTypes.string,
};

Project.propTypes = {
  setExpanded: PropTypes.func,
  expanded: PropTypes.bool,
  discography: PropTypes.object,
  titleComponent: PropTypes.object,
};

ProjectsToggleButton.propTypes = {
  setExpanded: PropTypes.func,
  expanded: PropTypes.bool,
};
