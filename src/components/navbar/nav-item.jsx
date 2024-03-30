import { Link } from "react-router-dom";
import PropTypes from "prop-types";
import { TextCursor } from "../text-cursor";

// ensures the view scrolls to item, even if url is the same
const HandleURL = (link, location) => {
  if (link == location) {
    let element = document.getElementById(link.slice(1));
    element.scrollIntoView({
      behavior: "smooth",
      block: "start",
      inline: "nearest",
    });
  }
};
HandleURL.propTypes = {
  e: PropTypes.object,
  location: PropTypes.object,
};

export const NavItem = ({ link, setExpanded, text }) => {
  return (
    <li className="transition-all duration-100 hover:scale-105">
      <Link
        className={`group hover:text-white p-5 font-light`}
        to={link}
        onClick={() => {
          setExpanded && setExpanded(false);
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

NavItem.propTypes = {
  text: PropTypes.string,
  link: PropTypes.string.isRequired,
  setExpanded: PropTypes.func,
};
