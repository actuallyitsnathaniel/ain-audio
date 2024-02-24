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
            <Discography.Disc
              artwork={starsRemix}
              title="Stars (riley remix)"
              appleMusicLink="https://music.apple.com/us/album/stars-riley-remix/1660688944?i=1660688945"
              spotifyLink="https://open.spotify.com/track/29NlMvw2a5h7o5sCqgJ7K3?si=f8ae2b4e9aa145b1"
              tidalLink=""
              youtubeLink="https://www.youtube.com/watch?v=9z8t3nt7ZmA"
            />
            <Discography.Disc
              artwork={iWas9Remix}
              title="I Was 9 (riley remix)"
              appleMusicLink="https://music.apple.com/us/album/i-was-9-riley-remix/1649318275?i=1649318276"
              spotifyLink="https://open.spotify.com/track/3F87Dak8Q41QSNbJfA6AMx?si=14fdcbed18374a3e"
              tidalLink="https://tidal.com/browse/album/253512701"
              youtubeLink="https://youtu.be/CsQ9kl_a1Y4?si=DOJsUs4qZvEmiplA"
            />
            <Discography.Disc
              artwork={better}
              title="Better (with John White and riley)"
              appleMusicLink="https://music.apple.com/us/album/better-single/1556313448"
              spotifyLink="https://open.spotify.com/track/52lu5hXrnYdWtPb90ImyA6?si=84018c33fb16478d"
              tidalLink="https://tidal.com/browse/track/244622029"
              youtubeLink="https://youtu.be/YkTWodHhM0o?si=ANBcBe_cGghTjFpJ"
            />
            <Discography.Disc
              artwork={losingHearts}
              title="Losing Hearts (feat. John White)"
              appleMusicLink="https://music.apple.com/us/album/losing-hearts-feat-john-white/1509147409?i=1509147412"
              spotifyLink="https://open.spotify.com/track/3lLtkLtBztQd8DiLCAORH5?si=f55f60cc305049c8"
              youtubeLink="https://youtu.be/AloaubmwGEA?si=Mn_ZeImQwfpXb_z8"
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
