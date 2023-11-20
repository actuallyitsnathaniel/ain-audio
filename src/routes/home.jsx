import profilePic from "../assets/images/ain-pfp.jpeg";
import TypeIt from "typeit-react";

import { TextCursor } from "../components/text-cursor";
import { SocialLinks } from "../components/social-links";

const Home = () => {
  return (
    <div className="flex h-screen flex-wrap flex-col justify-center">
      <h1 className="group w-min mx-auto duration-100 hover:scale-110">
        <SocialLinks
          className={
            "group-hover:scale-100 md:scale-0 md:blur-xl group-hover:blur-0"
          }
        />
        <span className="flex-nowrap text-base md:text-2xl font-light flex mb-7 justify-center mx-auto">
          <TypeIt options={{ cursor: "", speed: 55 }}>
            <span className="font-light hover:text-white -translate-x-6 cursor-default">
              @actuallyitsnathaniel
            </span>

            <TextCursor />
          </TypeIt>
        </span>
      </h1>
      <div className="flex h-1/3 justify-center">
        <img src={profilePic} className="rounded-full" alt="profilePic" />
      </div>
    </div>
  );
};

export default Home;
