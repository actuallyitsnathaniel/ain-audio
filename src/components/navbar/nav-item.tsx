import { Link, useLocation } from "react-router-dom";

export const NavItem = ({
  link,
  text,
  onItemClick,
}: {
  link: string;
  text: string;
  onItemClick?: () => void;
}) => {
  const location = useLocation();
  const isHashLink = link.startsWith("#");
  const hash = isHashLink ? link : null;

  // When on a non-root page, resolve hash links as /<hash> so React Router
  // navigates to root first, then ScrollToHashElement handles the scroll.
  const resolvedLink =
    isHashLink && location.pathname !== "/" ? `/${link}` : link;

  const handleClick = () => {
    // If already on root and clicking the same hash, manually scroll
    // (React Router won't re-trigger the scroll since location doesn't change)
    if (hash && location.pathname === "/" && location.hash === hash) {
      document
        .getElementById(hash.slice(1))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    onItemClick?.();
  };

  return (
    <li className="transition-all duration-100 hover:scale-105">
      <Link
        className={` hover:text-white p-5 font-light focus:outline-none focus-visible:underline focus-visible:decoration-white focus-visible:underline-offset-4`}
        to={resolvedLink}
        onClick={handleClick}
      >
        {text}
      </Link>
    </li>
  );
};
