import { PropTypes } from "prop-types";
import { ProfilePic, Project, Title } from "/src/components/project";
import Discography from "/src/components/discography";

import johnWhitePfp from "/src/assets/images/projects/john-white/johnWhitePfp.jpeg";

// EPs
import fakeSmilesEP from "/src/assets/images/projects/john-white/Singles_EPs/fake_smiles_ep600x600bb.jpeg";
import starsRemix from "/src/assets/images/projects/john-white/Singles_EPs/stars_remix_600x600bb.jpeg";

// Singles
import whoeverYouWantToBeSingle from "/src/assets/images/projects/john-white/Singles_EPs/whoever_you_want_to_be_single_600x600bb.jpeg";
import better2021Single from "/src/assets/images/projects/john-white/Singles_EPs/better_2021_single_600x600bb.jpeg";

export const JohnWhite = ({ i, expanded, HandleActiveArtist }) => {
  return (
    <div id="john-white">
      <ProfilePic
        i={i}
        image={johnWhitePfp}
        {...{ expanded, HandleActiveArtist }}
        titleComponent={
          <Title
            artistName={"John White"}
            subtitle={"singer/songwriter/producer"}
          />
        }
      />
      <Project
        {...{ i, expanded, HandleActiveArtist }}
        titleComponent={
          <Title
            artistName={"John White"}
            subtitle={"singer/songwriter/producer"}
          />
        }
        discography={
          <Discography>
            <Discography.Disc
              artwork={fakeSmilesEP}
              title={"betchu wish u could take it back"}
              spotifyLink={
                "https://open.spotify.com/album/5xG9WKhRF1ve48GMnDdInB?si=7y49yfvlRNqACC7uECI88g"
              }
              appleMusicLink={
                "https://embed.music.apple.com/us/album/fake-smiles-ep/1678254661"
              }
              soundcloudLink={
                "https://soundcloud.com/johnwhitesmusic/fake-smiles-mixmaster-1"
              }
              youtubeLink={
                "https://youtube.com/playlist?list=olak5uy_m2wbnwqklx4ez6u2smtzdiqnx5nsflqbi"
              }
            />
            <Discography.Disc
              artwork={starsRemix}
              title={"stars (riley remix)"}
              spotifyLink={
                "https://open.spotify.com/track/29NlMvw2a5h7o5sCqgJ7K3?si=4c5c7aacc383407a"
              }
              appleMusicLink={
                "https://music.apple.com/us/album/stars-riley-remix-single/1660688944"
              }
              soundcloudLink={""}
              youtubeLink={"https://youtu.be/9z8t3nt7zma"}
            />
            <Discography.Disc
              artwork={whoeverYouWantToBeSingle}
              title={"whoever you want to be - single"}
              spotifyLink={
                "https://open.spotify.com/track/42W4JMlVCjf41SmqcimLhz?si=e40a72ca719e4625"
              }
              appleMusicLink={
                "https://music.apple.com/us/album/whoever-you-want-to-be-single/1630867196"
              }
              soundcloudLink={
                "https://soundcloud.com/johnwhitesmusic/johnwhite-whoeveryouwanttobe"
              }
              youtubeLink={"https://youtu.be/toxcnzk9xoo"}
            />
            <Discography.Disc
              artwork={better2021Single}
              title={"better (with sam denton & riley) - single (2021)"}
              spotifyLink={
                "https://open.spotify.com/track/52lu5hXrnYdWtPb90ImyA6?si=112307d4c45a4830"
              }
              appleMusicLink={
                "https://music.apple.com/us/album/better-single/1556313448"
              }
              soundcloudLink={""}
              youtubeLink={"https://youtu.be/yktwodhhm0o"}
            />
          </Discography>
        }
      />
    </div>
  );
};

JohnWhite.propTypes = {
  i: PropTypes.number,
  expanded: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
};
