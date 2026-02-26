import profilePic from "/src/assets/images/ain-pfp.jpeg";
import TypeIt from "typeit-react";

import { SocialLinks } from "../components/social-links";
import AboutMe from "./about-me";

const Home = () => {
  return (
    <div id="home" className="flex min-h-screen flex-col justify-center">
      <h1 className="pt-20 mx-auto">
        <SocialLinks
          className={""}
          spotifyLink={
            "https://open.spotify.com/playlist/5YIJBk2ASIJqbd07gyOGdY?si=1cf595b570c24bf0"
          }
          youtubeLink={"https://www.youtube.com/@actuallyitsnathaniel"}
          instagramLink={"https://instagram.com/actuallyitsnathaniel"}
          gmailLink={"mailto:nathanielrbowman@gmail.com"}
        />
        <span className="flex-nowrap text-base md:text-2xl font-light flex mb-7 justify-center mx-auto">
          <TypeIt options={{ speed: 55, cursorChar: "_" }}>
            <span className="font-light -translate-x-6">
              @actuallyitsnathaniel
            </span>
          </TypeIt>
        </span>
      </h1>
      <div className="flex h-1/3 justify-center">
        <img
          src={profilePic}
          className="rounded-full max-h-80"
          alt="Nathaniel Bowman, music producer and audio engineer"
        />
      </div>
      <AboutMe />
    </div>
  );
};

export default Home;
