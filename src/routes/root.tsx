import Home from "./home";
import ProjectHighlights from "./music/projects";
import Press from "./press";

import VideoBG from "../components/video-background";
import Footer from "../components/footer";
import { NavBar } from "../components/navbar";
import ScrollToHashElement from "../utilities/ScrollToHashElement";
import SEO from "../components/seo";

const Root = () => {
  return (
    <>
      <SEO
        title="actually-its-nathaniel - Music Producer & Audio Engineer"
        description="Professional music producer and audio engineer specializing in modern production, mixing, and sound design. Explore my portfolio of projects and collaborations."
        url="https://audio.actuallyitsnathaniel.com"
        type="profile"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Person",
          name: "Nathaniel Bowman",
          alternateName: "actually-its-nathaniel",
          url: "https://audio.actuallyitsnathaniel.com",
          jobTitle: "Music Producer & Audio Engineer",
          knowsAbout: [
            "Music Production",
            "Audio Engineering",
            "Mixing",
            "Mastering",
            "Sound Design",
          ],
          sameAs: [
            "https://instagram.com/actuallyitsnathaniel",
            "https://www.youtube.com/@actuallyitsnathaniel",
            "https://open.spotify.com/playlist/5YIJBk2ASIJqbd07gyOGdY",
          ],
        }}
      />
      <div
        id="root"
        className="flex flex-col w-full text-center font-light *:text-white gap-10"
      >
        <VideoBG />
        <ScrollToHashElement />
        <Home />
        <ProjectHighlights />
        <Press />
        <Footer />
        <NavBar />
      </div>
    </>
  );
};

export default Root;
