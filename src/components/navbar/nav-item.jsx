import { Link } from "react-router-dom";
import PropTypes from "prop-types";
import { TextCursor } from "../text-cursor";

export const NavItem = (props) => {
  /**
   * TODO:
   * DESKTOP:
   *   - current page title should always be FOCUSED on navbar.
   *   - effect:
   *       - onClick, set as active page, similar to hover, but maybe bolded and underlined.
   */
  return (
    <li className="transition-all duration-100 hover:scale-105">
      <Link
        className={`group hover:text-white p-5 font-light`}
        to={props.link}
        onClick={() => {
          props.setExpanded && props.setExpanded(false);
        }}
      >
        <span>
          {props.text}
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
