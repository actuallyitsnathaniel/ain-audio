import SEO from "../components/seo";
import { DawShell } from "../daw/DawShell";
import { ArrangementPage } from "../daw/components/arrangement/ArrangementPage";

const StudioPage = () => {
  return (
    <>
      <SEO
        title="Studio - actuallyitsnathaniel"
        description="A browser DAW — a linear timeline studio: place MIDI, drum, and audio clips through the same audio engine that powers the rest of the site."
        url="https://audio.actuallyitsnathaniel.com/studio"
        type="website"
      />
      <DawShell>
        <ArrangementPage />
      </DawShell>
    </>
  );
};

export default StudioPage;
