import { PropTypes } from "prop-types";

import { Project, ProfilePic, Title } from "/src/components/project";
import Discography from "/src/components/discography";

import rileyPfp from "/src/assets/images/projects/riley/riley.jpg";
import losingHearts from "/src/assets/images/projects/riley/Singles_EPs/losing-hearts.jpg";
import iWas9Remix from "/src/assets/images/projects/riley/Singles_EPs/i-was-9-remix.png";
import better from "/src/assets/images/projects/riley/Singles_EPs/better.jpeg";
import starsRemix from "/src/assets/images/projects/riley/Singles_EPs/stars-remix.jpeg";

export const Riley = ({ i, expanded, HandleActiveArtist }) => {
  return (
    <div id="riley">
      <ProfilePic
        i={i}
        image={rileyPfp}
        {...{ expanded, HandleActiveArtist }}
        titleComponent={<Title artistName={"riley"} subtitle={"artist"} />}
      />
      <Project
        {...{ i, expanded, HandleActiveArtist }}
        titleComponent={<Title artistName="riley" subtitle="artist" />}
        discography={
          <Discography>
            {/* TODO: get all links */}
            <Discography.Disc
              artwork={starsRemix}
              title="Stars (riley remix)"
              appleMusicLink=""
              spotifyLink=""
              tidalLink=""
              youtubeLink=""
            />
            <Discography.Disc
              artwork={iWas9Remix}
              title="I Was 9 (riley remix)"
              appleMusicLink=""
              spotifyLink=""
              tidalLink=""
              youtubeLink=""
            />
            <Discography.Disc
              artwork={better}
              title="Better (with John White and riley)"
              appleMusicLink=""
              spotifyLink=""
              tidalLink=""
              youtubeLink=""
            />
            <Discography.Disc
              artwork={losingHearts}
              title="Losing Hearts (feat. John White)"
              appleMusicLink=""
              spotifyLink=""
              tidalLink=""
              youtubeLink=""
            />
          </Discography>
        }
      />
    </div>
  );
};

Riley.propTypes = {
  i: PropTypes.number,
  expanded: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
};
