import { Link } from "react-router-dom";
import { DawShell } from "../daw/DawShell";
import SEO from "../components/seo";

const CONTACT_EMAIL = "nathanielrbowman@gmail.com";

const linkClass =
  "italic underline underline-offset-2 text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-daw-text";

type Section = { heading: string; body?: string; list?: string[] };

const sections: Section[] = [
  {
    heading: "Studio & user content",
    body: 'The interactive studio on this site (arrangement, imports, recordings, exported .ain projects, and related tools) is provided as a creative workspace by Nathaniel Riley Bowman, professionally known as "actually-its-nathaniel" (the "Operator"). Anything you create, import, upload, record, or export with it is "User Content."',
  },
  {
    heading: "Your responsibility",
    body: "You are solely responsible for User Content and for ensuring you have all rights, licenses, and permissions needed to use it here — including samples, stems, loops, MIDI, presets, and any material that incorporates third-party copyrights, trademarks, or other protected works.",
  },
  {
    heading: "No license to infringe",
    body: "Nothing on this site grants permission to copy, sample, remix, distribute, or commercially exploit copyrighted or otherwise protected material that you do not own or control. The Operator does not review User Content for legality or rights clearance.",
  },
  {
    heading: "You may NOT",
    list: [
      "Import or distribute material you are not authorized to use.",
      "Use the studio to create or share works that infringe others' copyrights, neighboring rights, or trademarks.",
      "Misrepresent the Operator as endorsing, owning, or clearing rights for your User Content.",
    ],
  },
  {
    heading: "Disclaimer of liability",
    body: "To the fullest extent permitted by law, the Operator is not liable for claims, damages, or disputes arising from User Content or from your use of the studio — including alleged copyright infringement, unauthorized sampling, or rights-management conflicts between you and third parties. You agree to defend and hold the Operator harmless from such claims to the extent allowed by applicable law.",
  },
  {
    heading: "Operator's own music",
    body: "Separately, the Operator's portfolio music, previews, and site materials remain protected under the Usage & AI Policy. This disclaimer does not grant any rights in those works.",
  },
  {
    heading: "Agreement",
    body: "By using the studio — including importing audio, recording, saving, or exporting a project — you agree to this disclaimer. If you do not agree, do not use the studio.",
  },
];

const Disclaimer = () => {
  return (
    <DawShell>
      <SEO
        title="Studio Disclaimer"
        description="You are responsible for the rights to material you import or create in the AIN studio. Read the full disclaimer."
        url="https://audio.actuallyitsnathaniel.com/disclaimer"
      />
      <main className="relative z-1 flex justify-center px-6 pt-24 pb-16">
        <article className="max-w-3xl w-full rounded-sm border border-line bg-panel p-8 md:p-10 text-left">
          <header className="text-center pb-6 mb-6 border-b border-line">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-[-0.02em]">
              studio disclaimer
            </h1>
            <p className="mt-3 text-dim">
              User content, copyright, and your responsibility when using the
              studio
            </p>
          </header>

          <div className="md:columns-2 md:gap-8">
            {sections.map(({ heading, body, list }) => (
              <section key={heading} className="mb-6 break-inside-avoid">
                <h2 className="font-mono text-accent uppercase tracking-widest text-[12px] mb-2">
                  {heading}
                </h2>
                {body && (
                  <p className="text-daw-text leading-relaxed">{body}</p>
                )}
                {list && (
                  <ul className="list-disc list-inside text-daw-text leading-relaxed space-y-1">
                    {list.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            <section className="mb-6 break-inside-avoid">
              <h2 className="font-mono text-accent uppercase tracking-widest text-[12px] mb-2">
                Related
              </h2>
              <p className="text-daw-text leading-relaxed">
                For the Operator&apos;s own music and AI/ML restrictions, see
                the{" "}
                <Link className={linkClass} to="/usage-and-ai-policy">
                  usage &amp; AI policy
                </Link>
                . Questions:&nbsp;
                <a className={linkClass} href={`mailto:${CONTACT_EMAIL}`}>
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
            </section>
          </div>
        </article>
      </main>
    </DawShell>
  );
};

export default Disclaimer;
