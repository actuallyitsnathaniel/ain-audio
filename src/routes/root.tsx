import SEO from "../components/seo";
import { DawShell } from "../daw/DawShell";
import { DawHome } from "../daw/DawHome";

const Root = () => {
  return (
    <>
      <SEO
        title="Audio - actuallyitsnathaniel"
        description="Professional music producer and audio engineer specializing in modern production, mixing, and sound design. Explore my portfolio of projects and collaborations."
        url="https://audio.actuallyitsnathaniel.com"
        type="profile"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Person",
          name: "Nathaniel Bowman",
          alternateName: "actuallyitsnathaniel",
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
      <DawShell>
        <DawHome />
      </DawShell>
    </>
  );
};

export default Root;
