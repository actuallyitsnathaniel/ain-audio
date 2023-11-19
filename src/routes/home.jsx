// import { useState } from "react";
import profilePic from "../assets/images/ain-pfp.jpeg";
import { TextCursor } from "../components/text-cursor";
import TypeIt from "typeit-react";

import { SocialLinks } from "../components/social-links";

const Home = () => {
  // eslint-disable-next-line no-unused-vars

  return (
    <div className="flex h-screen flex-wrap flex-col justify-center">
      <h1 className="group w-min mx-auto">
        <SocialLinks
          className={"group-hover:scale-100 scale-0 blur-xl group-hover:blur-0"}
        />
        <span className="flex-nowrap text-base transition-all duration-100 md:text-2xl font-light flex mb-7 justify-center mx-auto hover:scale-110 ">
          <TypeIt options={{ cursor: "", speed: 55 }}>
            <span
              className="font-light transition-all duration-100 hover:text-white -translate-x-6 cursor-default"
              onClick={() =>
                alert("TODO: add social links to float above on click.")
              }
            >
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
