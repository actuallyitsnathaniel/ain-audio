import { useState } from "react";
import profilePic from "../assets/images/ain-pfp.jpeg";
import { TextCursor } from "../components/text-cursor";
import TypeIt from "typeit-react";

const useHover = () => {
  const [hovering, setHovering] = useState(false);
  const onHoverProps = {
    onMouseEnter: () => setHovering(true),
    onMouseLeave: () => setHovering(false),
  };
  return [hovering, onHoverProps];
};

const Home = () => {
  const [titleIsHovering, titleHoverProps] = useHover();

  return (
    <div className="flex h-screen flex-wrap flex-col justify-center">
      {
        <h1 className="group hover:text-cyan-500 font-light flex my-7 justify-center mx-auto w-fit md:translate-x-2 overflow-clip">
          <span>
            <TypeIt options={{ cursor: "", speed: 90 }}>
              <a
                className="hover:text-cyan-500 font-light "
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
    </div>
  );
};

export default Home;
