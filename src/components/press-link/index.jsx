import { PropTypes } from "prop-types";

export const PressLink = ({ href, title, subtitle }) => {
  return (
    <div id="press-link">
      <div className="md:transition md:duration-75 md:ease-in-out md:hover:scale-110 max-w-sm">
        <a className="font-semibold p-5 text-xl" href={href}>
          &quot;{title}&quot;
        </a>
      </div>
      <p className="text-lg italic">{subtitle}</p>
    </div>
  );
};

PressLink.propTypes = {
  href: PropTypes.string,
  title: PropTypes.string,
  subtitle: PropTypes.string,
};
