import { Link, useLocation } from "react-router-dom";
import { TextCursor } from "../text-cursor";

export const NavItem = ({
  link,
  text,
  onItemClick
}: {
  link: string;
  text: string;
  onItemClick?: () => void;
}) => {
  const location = useLocation();

  const handleClick = () => {
    // Extract just the hash portion from the link (e.g. "/#home" -> "#home")
    const hash = link.includes("#") ? "#" + link.split("#")[1] : null;
    // If already on root and clicking the same hash, manually scroll (React Router won't re-trigger)
    if (hash && location.pathname === "/" && location.hash === hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    onItemClick?.();
  };

  return (
    <li className="transition-all duration-100 hover:scale-105">
      <Link
        className={`group hover:text-white p-5 font-light focus:outline-none focus-visible:underline focus-visible:decoration-white focus-visible:underline-offset-4`}
        to={link}
        onClick={handleClick}
      >
        <span>
          {text}
          <TextCursor />
        </span>
      </Link>
    </li>
  );
};
