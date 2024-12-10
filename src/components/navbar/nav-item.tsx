import { Link } from "react-router-dom";
import { TextCursor } from "../text-cursor";

// ensures the view scrolls to item, even if url is the same
const HandleURL = (link: string, location: string) => {
  if (link == location) {
    const element = document.getElementById(link.slice(1));
    element?.scrollIntoView({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
  }
};

export const NavItem = ({ link, text }: { link: string; text: string }) => {
  return (
    <li className="transition-all duration-100 hover:scale-105">
      <Link
        className={`group hover:text-white p-5 font-light`}
        to={link}
        onClick={() => {
          HandleURL(link, location.hash);
        }}
      >
        <span>
          {text}
          <TextCursor />
        </span>
      </Link>
    </li>
  );
};
