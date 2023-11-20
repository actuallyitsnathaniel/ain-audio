// import React from "react";
import { PropTypes } from "prop-types";

const Description = ({ description }) => {
  return <p>{description}</p>;
};

const Title = (title) => {
  return <h4 className="text-xl">{title}</h4>;
};

const Music = (discography) => {
  return <div>{discography}</div>;
};

export const Project = ({ children }) => {
  // TODO: build this out after Sam's project is complete
  return console.log({ children });
};

Project.propTypes = {
  children: PropTypes.array,
};

Title.propTypes = {
  title: PropTypes.string,
};

Music.propTypes = {
  discography: PropTypes.array,
};

Description.propTypes = {
  description: PropTypes.string,
};

Project.Description = Description;
Project.Title = Title;
Project.Music = Music;
