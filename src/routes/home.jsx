import { useState } from "react";
import profilePic from "../assets/images/ain-pfp.jpeg";
import { TextCursor } from "../components/text-cursor";
import TypeIt from "typeit-react";

import { SocialLinks } from "../components/social-links";

const useHover = () => {
  const [hovering, setHovering] = useState(false);
  const onHoverProps = {
    onMouseEnter: () => setHovering(true),
    onMouseLeave: () => setHovering(false),
  };
  return [hovering, onHoverProps];
};

const Home = () => {
  // eslint-disable-next-line no-unused-vars
  const [titleIsHovering, titleHoverProps] = useHover();

  return (
    <div className="flex h-screen flex-wrap flex-col justify-center">
      {
        <h1 className="group font-light flex my-7 justify-center mx-auto w-fit md:translate-x-2 overflow-clip">
          <span className="flex flex-nowrap text-base md:text-2xl">
            <TypeIt options={{ cursor: "", speed: 90 }}>
              <a
                className="font-light transition-all duration-100 hover:text-white hover:scale-105"
                href="https://www.instagram.com/actuallyitsnathaniel"
                rel="noopener noreferrer"
                target="_blank"
                onClick={() =>
                  alert("TODO: add social links to float above on click.")
                }
              >
                @actuallyitsnathaniel
              </a>

              <TextCursor />
            </TypeIt>
          </span>
        </h1>
      }
      <div className="flex h-1/3 justify-center overflow-clip">
        <img src={profilePic} className="rounded-full" alt="profilePic" />
      </div>
      <SocialLinks />
    </div>
  );
};

export default Home;
