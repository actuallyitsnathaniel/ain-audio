import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

const ProfilePic = ({
  id,
  image,
  titleComponent,
}: {
  id: string;
  image: string;
  titleComponent: JSX.Element;
}) => {
  return (
    <Link
      id={`${id}-pfp`}
      to={`#projects/${id}`}
      className="group appearance-none flex flex-col text-3xl mx-auto p-8 transition-transform duration-100 md:hover:scale-105 border-none"
    >
      <img
        src={image}
        alt="profile-pic-alt"
        className="transition-scale max-h-64 object-contain rounded-xl"
      />
      <div className="flex transition-translate duration-75 md:group-hover:translate-y-0.5 mx-auto">
        {titleComponent}
      </div>
    </Link>
  );
};

const Title = ({
  artistName,
  id,
  subtitle,
}: {
  artistName: string;
  id?: string;
  subtitle: string;
}) => {
  return (
    <div className="py-3 justify-center w-full" id={`${id}-title`}>
      <p className="flex justify-center text-2xl">{artistName}</p>
      <p id={`${id}-subtitle`} className="text-lg italic">
        {subtitle}
      </p>
    </div>
  );
};

export const Project = ({
  id,
  works,
  description,
  titleComponent,
}: {
  id: string;
  works: JSX.Element;
  description: JSX.Element;
  titleComponent: JSX.Element;
}) => {
  const [truncateText, setTruncateText] = useState(true);
  const location = useLocation();
  const isFocused = location.hash.includes(id);

  return (
    <div
      {...{ id }}
      className={`fixed top-0 left-0 z-[4] flex flex-col items-center text-white transition-all duration-100 ease-in-out bg-black bg-opacity-80 w-screen scroll- backdrop-blur-md ${
        isFocused ? "scale-100 h-screen blur-none" : "scale-0 h-0 blur-lg"
      }`}
    >
      <ProjectsToggleButton />
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

const ProjectsToggleButton = () => {
  const isFocused = location.hash !== "/";

  return (
    <Link
      data-collapse-toggle="navbar"
      id="navbar-icon"
      type="button"
      className={`flex flex-col fixed top-3 left-2 m-3 z-[4] duration-200 translate-x-3`}
      aria-controls="navbar"
      aria-expanded="false"
      to="/"
    >
      <span
        className={`flex w-12 h-1 mb-2.5 relative bg-white rounded-sm origin-top-left duration-200 ${
          isFocused ? "rotate-45" : "rotate-0"
        }`}
      />
      <span
        className={`flex w-12 h-1 mb-2.5 relative bg-white rounded-sm origin-center duration-200 ${
          isFocused
            ? "rotate-180 opacity-0 scale-0"
            : "rotate-0 scale-100 opacity-100"
        }`}
      />
      <span
        className={`flex w-12 h-1 mb-2.5 relative bg-white rounded-sm origin-bottom-left duration-200 ${
          isFocused ? "-rotate-45 translate-y-[5px]" : "rotate-0 translate-y-0"
        }`}
      />
    </Link>
  );
};

Project.Title = Title;
Project.ProfilePic = ProfilePic;
