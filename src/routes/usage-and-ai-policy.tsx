import VideoBG from "../components/video-background";
import Footer from "../components/footer";
import { NavBar } from "../components/navbar";
import SEO from "../components/seo";

const CONTACT_EMAIL = "nathanielrbowman@gmail.com";

const linkClass =
  "italic underline underline-offset-2 text-purple-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-white";

// All policy copy lives here so wording can be tweaked without touching layout.
type Section = { heading: string; body?: string; list?: string[] };

const sections: Section[] = [
  {
    heading: "Copyright",
    body: 'All music, audio recordings, compositions, lyrics, and stems on this site are the original work of Nathaniel Riley Bowman, professionally known as "actually-its-nathaniel" (the "Artist"). All rights reserved.',
  },
  {
    heading: "Associated work",
    body: "This policy applies in full to every work listed anywhere on this site — including all releases, discography, project pages, collaborations, and press materials. Any associated work referenced here abides by this same Usage & AI Policy, regardless of where it is hosted or embedded.",
  },
  {
    heading: "Permitted use",
    body: "You may listen to the Artist's music for personal, non-commercial enjoyment, or as explicitly licensed in writing by the Artist. No other rights are granted.",
  },
  {
    heading: "No AI / ML grant",
    body: "Nothing on this site grants permission to use the Artist's work for artificial intelligence or machine learning training, fine-tuning, evaluation, or dataset creation. No such right is implied by access, streaming, or download.",
  },
  {
    heading: "You may NOT",
    list: [
      "Include the Artist's audio, compositions, or lyrics in any AI or ML dataset.",
      "Use the Artist's work to train, fine-tune, or evaluate any AI or ML model.",
      'Build tools or services that generate music "in the style of actually-its-nathaniel" or otherwise imitate the Artist\'s sound, voice, or production.',
    ],
  },
  {
    heading: "Licensing",
    body: "Any license to the Artist's work — present or future — excludes AI and ML rights unless those rights are explicitly granted in writing by the Artist.",
  },
  {
    heading: "Agreement",
    body: "By accessing, streaming, or downloading the Artist's work, you agree to this policy. Unauthorized use may violate the Artist's rights and applicable laws, and will be pursued to the fullest extent of the law.",
  },
];

const UsageAndAiPolicy = () => {
  return (
    <>
      <SEO
        title="Usage & AI Policy"
        description="The music of actually-its-nathaniel (Nathaniel Riley Bowman) is not licensed for AI or machine learning training. Read the full usage and AI policy."
        url="https://audio.actuallyitsnathaniel.com/usage-and-ai-policy"
      />
      <div
        id="root"
        className="flex flex-col min-h-screen w-full text-center font-light *:text-white"
      >
        <VideoBG />
        <main className="flex-grow flex items-center justify-center px-6 pt-24 pb-16">
          <article className="max-w-3xl w-full bg-black/60 backdrop-blur-md rounded-xl p-8 md:p-10 text-left">
            <header className="text-center pb-6 mb-6 border-b border-white/20">
              <h1 className="text-4xl md:text-5xl font-light lowercase">
                usage &amp; ai policy
              </h1>
              <p className="mt-3 text-white/70">
                Nathaniel Riley Bowman, professionally known as
                &nbsp;&ldquo;actually-its-nathaniel&rdquo;
              </p>
            </header>

            <div className="md:columns-2 md:gap-8">
              {sections.map(({ heading, body, list }) => (
                <section
                  key={heading}
                  className="mb-6 break-inside-avoid"
                >
                  <h2 className="text-cyan-500 uppercase tracking-widest text-sm mb-2">
                    {heading}
                  </h2>
                  {body && (
                    <p className="text-white/80 leading-relaxed">{body}</p>
                  )}
                  {list && (
                    <ul className="list-disc list-inside text-white/80 leading-relaxed space-y-1">
                      {list.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}

              <section className="mb-6 break-inside-avoid">
                <h2 className="text-cyan-500 uppercase tracking-widest text-sm mb-2">
                  Inquiries
                </h2>
                <p className="text-white/80 leading-relaxed">
                  Research, licensing, or technology inquiries require written
                  approval. Direct all inquiries to the Artist at&nbsp;
                  <a className={linkClass} href={`mailto:${CONTACT_EMAIL}`}>
                    {CONTACT_EMAIL}
                  </a>
                  .
                </p>
              </section>
            </div>
          </article>
        </main>
        <Footer />
        <NavBar />
      </div>
    </>
  );
};

export default UsageAndAiPolicy;
