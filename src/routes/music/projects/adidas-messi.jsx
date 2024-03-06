import { PropTypes } from "prop-types";

import { ProfilePic, Project, Title } from "/src/components/project";

import adidasMessi from "/src/assets/images/projects/adidas-messi/adidas-messi-sq.jpeg";

export const AdidasMessi = ({ i, expanded, HandleActiveArtist }) => {
  return (
    <div id="adidas">
      <ProfilePic
        i={i}
        image={adidasMessi}
        {...{ expanded, HandleActiveArtist }}
        titleComponent={
          <Title artistName={"Adidas x Messi"} subtitle="marketing campaign" />
        }
      />
      <Project
        {...{ i, expanded, HandleActiveArtist }}
        titleComponent={
          <Title artistName={"Adidas x Messi"} subtitle="Marketing Campaign" />
        }
        description={
          <>
            I had the honor of sharing my sounds with the talent of&nbsp;
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
          <>
            <iframe
              className="flex mx-auto p-3 w-fit aspect-[4/5] justify-center"
              src="https://player.vimeo.com/video/893859181?h=bbbd4b0aae"
              allowFullScreen
            ></iframe>
            <iframe
              className="flex mx-auto p-3 w-fit md:w-1/2 aspect-[16/9.25] justify-center"
              src="https://player.vimeo.com/video/873468787?h=ebe0c2ae9f"
              allowFullScreen
            ></iframe>
          </>
        }
      />
    </div>
  );
};

AdidasMessi.propTypes = {
  i: PropTypes.number,
  expanded: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
};
