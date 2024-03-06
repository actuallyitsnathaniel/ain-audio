import { PropTypes } from "prop-types";
import { ProfilePic, Project, Title } from "/src/components/project";
import Discography from "/src/components/discography";

import brandXBlue from "/src/assets/images/projects/brandx/brand-x-blue.jpg";

import spiraling from "/src/assets/images/projects/brandx/works/norml-spiraling_600x600bb.jpg";
import popFestVol2 from "/src/assets/images/projects/brandx/works/popfest-vol2-600x600bb.jpg";
import tomsDinerCover from "/src/assets/images/projects/brandx/works/toms-diner-cover.png";

export const BrandX = ({ i, expanded, HandleActiveArtist }) => {
  return (
    <div id="brand-x">
      <ProfilePic
        i={i}
        image={brandXBlue}
        {...{ expanded, HandleActiveArtist }}
        titleComponent={
          <Title artistName={"Brand X"} subtitle={"sync/label"} />
        }
      />
      <Project
        {...{ i, expanded, HandleActiveArtist }}
        titleComponent={
          <Title artistName={"Brand X"} subtitle={"sync/label"} />
        }
        works={
          <Discography>
            <Discography.Disc
              artwork={spiraling}
              title="Spiraling (from Spiraling EP)"
              spotifyLink="https://open.spotify.com/track/2GUzeTEMKnWAjMWYA1Ui4V?si=5c39d40150734f62"
              youtubeLink="https://www.youtube.com/watch?v=AfTfGX5Wvrg&list=OLAK5uy_lhtTc3b8h0HPzM8iobZ40xmw4Cn38tGos"
              appleMusicLink="https://music.apple.com/us/album/spiraling/1668083016?i=1668083021"
            />
            <Discography.Disc
              artwork={tomsDinerCover}
              title="Tom's Diner (from Mixtape)"
              spotifyLink="https://open.spotify.com/track/4zBtv57k0H4dFcvSZSWDla?si=3ba3c0c6c8fe445f"
              youtubeLink="https://www.youtube.com/watch?v=H8iVHmDxlBk"
              appleMusicLink="https://music.apple.com/id/album/toms-diner/1705680543?i=1705680547"
            />
            <Discography.Disc
              artwork={popFestVol2}
              title="Don't Pretend (from Popfest Vol. 2)"
              spotifyLink="https://open.spotify.com/track/63SLRotYth5eukYcJw0Trt?si=939f1c747cb14117"
              youtubeLink="https://www.youtube.com/watch?v=bjuaf-LfdWg"
              appleMusicLink="https://music.apple.com/us/album/dont-pretend/1692907111?i=1692907112"
            />
          </Discography>
        }
      />
    </div>
  );
};

BrandX.propTypes = {
  i: PropTypes.number,
  expanded: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
};
