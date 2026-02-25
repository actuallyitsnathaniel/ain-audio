import { useState, memo, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { JSX } from "react/jsx-runtime";

const getTextLength = (node: ReactNode): number => {
  if (!node) return 0;
  if (typeof node === "string") return node.length;
  if (typeof node === "number") return String(node).length;
  if (Array.isArray(node)) return node.reduce((sum, child) => sum + getTextLength(child), 0);
  if (typeof node === "object" && "props" in (node as object)) return getTextLength((node as { props: { children?: ReactNode } }).props.children);
  return 0;
};

const ProfilePic = memo(
  ({
    id,
    image,
    alt,
    titleComponent,
    isStandalone = false,
  }: {
    id: string;
    image: string;
    alt?: string;
    titleComponent: JSX.Element;
    isStandalone?: boolean;
  }) => {
    const imgAlt = alt ?? id.replace(/-/g, " ");

    // On standalone project pages, don't wrap in a link
    if (isStandalone) {
      return (
        <div
          id={`${id}-pfp`}
          className="flex flex-col text-3xl w-full items-center p-8"
        >
          <img
            src={image}
            alt={imgAlt}
            className="max-h-64 object-contain rounded-xl"
          />
          <div className="flex mx-auto">{titleComponent}</div>
        </div>
      );
    }

    return (
      <Link
        id={`${id}-pfp`}
        to={`/projects/${id}`}
        data-project-card
        className="group appearance-none flex flex-col text-3xl mx-auto p-8 transition-all duration-200 md:hover:scale-[1.03] md:hover:bg-white/10 md:hover:border-white/20 md:hover:shadow-lg md:hover:shadow-white/5 border border-transparent cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-xl"
      >
        <img
          src={image}
          alt={imgAlt}
          className="max-h-64 object-contain rounded-xl"
        />
        <div className="flex transition-transform duration-75 md:group-hover:translate-y-0.5 mx-auto">
          {titleComponent}
        </div>
      </Link>
    );
  },
);

const Title = memo(
  ({
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
  },
);

const TRUNCATE_THRESHOLD = 280;

const ProjectComponent = memo(
  ({
    id,
    works,
    description,
    titleComponent,
    isStandalone = false,
  }: {
    id: string;
    works: JSX.Element;
    description: JSX.Element;
    titleComponent: JSX.Element;
    isStandalone?: boolean;
  }) => {
    const shouldTruncate = getTextLength(description) > TRUNCATE_THRESHOLD;
    const [truncateText, setTruncateText] = useState(true);
    const location = useLocation();
    const isFocused = isStandalone || location.hash.includes(id);

    // Standalone mode: render inline without overlay
    if (isStandalone) {
      return (
        <div
          {...{ id }}
          className="flex flex-col items-center text-white w-full"
        >
          <div className="w-full max-w-5xl mx-auto px-4">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as const, delay: 0.05 }}
              className="relative mx-auto px-6"
            >
              <motion.div
                animate={{
                  maxHeight: shouldTruncate && truncateText ? "4.5rem" : "100rem",
                  "--mask-stop": shouldTruncate && truncateText ? "40%" : "100%",
                } as object}
                transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const }}
                style={{
                  WebkitMaskImage: shouldTruncate ? "linear-gradient(to bottom, black var(--mask-stop), transparent 100%)" : "none",
                  maskImage: shouldTruncate ? "linear-gradient(to bottom, black var(--mask-stop), transparent 100%)" : "none",
                  ["--mask-stop" as string]: shouldTruncate && truncateText ? "40%" : "100%",
                }}
                className="overflow-hidden"
              >
                <p className="text-justify">
                  {description ?? (
                    <span className="text-center italic block">
                      still getting my words together for this project. be patient!
                    </span>
                  )}
                </p>
              </motion.div>
            </motion.div>

            {description && shouldTruncate && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as const, delay: 0.1 }}
                className="p-6 items-center align-middle"
              >
                <button
                  onClick={() => setTruncateText(!truncateText)}
                  className="border border-spacing-10 p-3 pt-2 rounded-md border-white underline underline-offset-2 cursor-pointer italic focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  {truncateText ? "more" : "less"}
                </button>
              </motion.div>
            )}

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] as const, delay: 0.18 }}
            >
              {works}
            </motion.div>
          </div>
        </div>
      );
    }

    // Hash-based overlay mode (legacy support for homepage)
    return (
      <div
        {...{ id }}
        className={`fixed top-0 left-0 z-4 flex flex-col items-center text-white transition-all duration-100 ease-in-out bg-black bg-opacity-80 w-screen backdrop-blur-md ${
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
            className={`max-w-5xl mx-auto px-10 text-justify ${
              shouldTruncate && truncateText && "line-clamp-3 text-ellipsis overflow-hidden"
            }`}
          >
            {description ? (
              description
            ) : (
              <span className="text-center italic block">
                still getting my words together for this project. be patient!
              </span>
            )}
          </p>

          {description && shouldTruncate && (
            <div className="p-6 items-center align-middle">
              <button
                onClick={() => setTruncateText(!truncateText)}
                className="border border-spacing-10 p-3 pt-2 rounded-md border-white underline underline-offset-2 cursor-pointer italic focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                {truncateText ? "more" : "less"}
              </button>
            </div>
          )}

          {works}
        </div>
      </div>
    );
  },
);

export const Project = ProjectComponent as typeof ProjectComponent & {
  Title: typeof Title;
  ProfilePic: typeof ProfilePic;
};

const ProjectsToggleButton = () => {
  const location = useLocation();
  const isFocused = location.hash !== "/";

  return (
    <Link
      data-collapse-toggle="navbar"
      id="navbar-icon"
      type="button"
      className={`flex flex-col fixed top-3 left-2 m-3 z-4 duration-200 translate-x-3`}
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
          isFocused ? "-rotate-45 translate-y-1.25" : "rotate-0 translate-y-0"
        }`}
      />
    </Link>
  );
};

Project.Title = Title;
Project.ProfilePic = ProfilePic;
