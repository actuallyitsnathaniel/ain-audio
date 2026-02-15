import { useRef, memo } from "react";
import { useLocation } from "react-router-dom";

import { Project } from "../../../components/project";
import SEO from "../../../components/seo";

import adidasMessi from "/src/assets/images/projects/adidas-messi/adidas-messi-sq.jpeg";

export const AdidasMessi = memo(({ id }: { id: string }) => {
  const adidasVideos = useRef([]);
  const Title = (
    <Project.Title
      artistName={"Adidas x Messi"}
      subtitle="marketing campaign"
    />
  );
  const isFocused = useLocation().hash == "#projects/adidas-messi";

  return (
    <div {...{ id }}>
      <SEO
        title="Adidas x Messi - Marketing Campaign"
        description="Sound design work for the Adidas marketing campaign welcoming Lionel Messi to Inter Miami. Audio production by Nathaniel Bowman."
        url="https://audio.actuallyitsnathaniel.com/#projects/adidas-messi"
        type="website"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "CreativeWork",
          "name": "Adidas x Messi Marketing Campaign",
          "description": "Sound design for the Adidas marketing campaign welcoming Lionel Messi to Inter Miami.",
          "creator": {
            "@type": "Person",
            "name": "Nathaniel Bowman"
          },
          "url": "https://audio.actuallyitsnathaniel.com/#projects/adidas-messi"
        }}
      />
      <Project.ProfilePic
        {...{ id }}
        image={adidasMessi}
        titleComponent={Title}
      />

      <Project
        {...{ id }}
        titleComponent={Title}
        description={
          <>
            I had the honor of doing some sound design with the talent of&nbsp;
            <a
              rel="noopener noreferrer"
              target="_blank"
              className="text-cyan-500"
              href="https://jakecdahm.com/"
            >
              Jake Dahm
            </a>
            , an incredibly talented videographer and editor, who was tasked
            with creating content for the marketing campaign that welcomed&nbsp;
            <a
              rel="noopener noreferrer"
              target="_blank"
              className="text-cyan-500"
              href="https://g.co/kgs/cu5HKe2"
            >
              Lionel Messi
            </a>
            &nbsp; to the Major League Soccer Club Inter Miami with&nbsp;
            <a
              rel="noopener noreferrer"
              target="_blank"
              className="text-cyan-500"
              href="https://adidas.com"
            >
              Adidas
            </a>
            . Impacts, sweeps, and other general foley-esque sounds of mine were
            used to help welcome Messi to the U.S. via the experience of this
            campaign.
          </>
        }
        works={
          <div
            id="vimeo-embeds"
            className={`${!isFocused && "hidden pointer-events-none"}`}
            // TODO: stop video on project close
          >
            {isFocused && (
              <>
                <iframe
                  ref={(element: never) => (adidasVideos.current[0] = element)}
                  className="flex mx-auto p-3 w-fit aspect-[4/5] justify-center"
                  src="https://player.vimeo.com/video/893859181?h=bbbd4b0aae"
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  loading="lazy"
                />
                <iframe
                  ref={(element: never) => (adidasVideos.current[1] = element)}
                  className="flex mx-auto p-3 w-fit md:w-1/2 aspect-[16/9.25] justify-center"
                  src="https://player.vimeo.com/video/873468787?h=ebe0c2ae9f"
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  loading="lazy"
                />
              </>
            )}
          </div>
        }
      />
    </div>
  );
});
