import SEO from "../components/seo";
import { DawShell } from "../daw/DawShell";
import { Beatmaker } from "../daw/components/sequencer/Beatmaker";

const BeatmakerPage = () => {
  return (
    <>
      <SEO
        title="Beat Maker - actuallyitsnathaniel"
        description="A browser drum sequencer — build a beat step by step through the same audio engine that powers the rest of the site."
        url="https://audio.actuallyitsnathaniel.com/beatmaker"
        type="website"
      />
      <DawShell>
        <Beatmaker />
      </DawShell>
    </>
  );
};

export default BeatmakerPage;
