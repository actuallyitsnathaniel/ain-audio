import SEO from "../components/seo";
import { DawShell } from "../daw/DawShell";
import { DawHome } from "../daw/DawHome";
import { useAudioContent } from "../sanity/AudioContentContext";

const Root = () => {
  const { siteDescription, socials } = useAudioContent();
  const description =
    siteDescription ||
    "Professional music producer and audio engineer specializing in modern production, mixing, and sound design. Explore my portfolio of projects and collaborations.";
  return (
    <>
      <SEO
        title="audio | actuallyitsnathaniel"
        description={description}
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
          sameAs: [socials.instagram, socials.youtube, socials.spotify],
        }}
      />
      <DawShell>
        <DawHome />
      </DawShell>
    </>
  );
};

export default Root;
