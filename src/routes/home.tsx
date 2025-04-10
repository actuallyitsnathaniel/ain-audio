import profilePic from "/src/assets/images/ain-pfp.jpeg";
import TypeIt from "typeit-react";

import { TextCursor } from "../components/text-cursor";
import { SocialLinks } from "../components/social-links";
import AboutMe from "./about-me";

const Home = () => {
  return (
    <div
      id="home"
      className="animate-appear flex min-h-screen flex-col justify-center"
    >
      <h1 className="pt-20 group mx-auto duration-100 hover:scale-110 hover:text-white">
        <SocialLinks
          className={
            "group-hover:scale-100 md:scale-0 md:blur-xl group-hover:blur-0"
          }
          spotifyLink={
            "https://open.spotify.com/playlist/5YIJBk2ASIJqbd07gyOGdY?si=1cf595b570c24bf0"
          }
          youtubeLink={"https://www.youtube.com/@actuallyitsnathaniel"}
          instagramLink={"https://instagram.com/actuallyitsnathaniel"}
          gmailLink={"mailto:nathanielrbowman@gmail.com"}
        />
        <span className="flex-nowrap text-base md:text-2xl font-light flex mb-7 justify-center mx-auto">
          <TypeIt options={{ cursor: undefined, speed: 55 }}>
            <span className="font-light -translate-x-6 cursor-default">
              @actuallyitsnathaniel
            </span>

            <TextCursor />
          </TypeIt>
        </span>
      </h1>
      <div className="flex h-1/3 justify-center">
        <img
          src={profilePic}
          className="rounded-full max-h-80"
          alt="profilePic"
        />
      </div>
      <AboutMe />
    </div>
  );
};

export default Home;
