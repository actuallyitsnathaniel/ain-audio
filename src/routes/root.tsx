import SEO from "../components/seo";
import { DawShell } from "../daw/DawShell";
import { DawHome } from "../daw/DawHome";
import { useAudioContent } from "../sanity/AudioContentContext";

const Root = () => {
  const { socials, siteDescription } = useAudioContent();
  return (
    <>
      <SEO
        title="audio | actuallyitsnathaniel"
        description={siteDescription}
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
          sameAs: [socials.instagram, socials.youtube, socials.spotify, socials.soundbetter],
        }}
      />
      <DawShell>
        <DawHome />
      </DawShell>
    </>
  );
};

export default Root;
