import { PropTypes } from "prop-types";
import { ProfilePic, Project, Title } from "/src/components/project";
import Discography from "/src/components/discography";

import platinumRoses from "/src/assets/images/projects/platinum-roses/platinum-roses.jpeg";
import oneThingIKnow from "/src/assets/images/projects/platinum-roses/discography/one-thing-i-know-single.jpg";
import whatdIDo from "/src/assets/images/projects/platinum-roses/discography/whatd-i-do-single.jpg";
import contemplate from "/src/assets/images/projects/platinum-roses/discography/contemplate-single.jpg";

export const PlatinumRoses = ({ i, expanded, HandleActiveArtist }) => {
  return (
    <div id="platinum-roses">
      <ProfilePic
        i={i}
        image={platinumRoses}
        {...{ expanded, HandleActiveArtist }}
        titleComponent={
          <Title
            artistName={"Platinum Roses"}
            subtitle={"songwriter/producer duo"}
          />
        }
      />
      <Project
        {...{ i, expanded, HandleActiveArtist }}
        titleComponent={
          <Title
            artistName={"Platinum Roses"}
            subtitle={"songwriter/producer duo"}
          />
        }
        works={
          <Discography>
            <Discography.Disc
              title="Contemplate - single"
              artwork={contemplate}
              spotifyLink="https://open.spotify.com/track/2ELwGfn2Csr7g6xo41ijtG?si=dc09680c17bd4fc6"
              youtubeLink="https://youtu.be/vxj_UcpPxaw?si=poVRRqn0C2k0dMyn"
              appleMusicLink="https://music.apple.com/us/album/contemplate-single/1445320598"
              soundcloudLink="https://on.soundcloud.com/7eKxH"
            />
            <Discography.Disc
              title="What'd I Do - single"
              artwork={whatdIDo}
              spotifyLink="https://open.spotify.com/track/5kj8UE9PJWi1eMKRPKAzsL?si=a9a879f0b8054fa5"
              youtubeLink="https://youtu.be/fzHnkK12r_U?si=6rVEtnHLg0Z_twLF"
              appleMusicLink="https://music.apple.com/us/album/whatd-i-do-single/1362745750"
              soundcloudLink="https://on.soundcloud.com/kATbu"
            />
            <Discography.Disc
              title="One Thing I Know - single"
              artwork={oneThingIKnow}
              spotifyLink="https://open.spotify.com/track/7gXk8WVfiAitbPjDSTv0L8?si=9da86dab6c694505"
              youtubeLink="https://youtu.be/2rWabGeJPUA?si=SpETE2jfm1LocQMe"
              appleMusicLink="https://music.apple.com/us/album/one-thing-i-know-single/1320562860"
              soundcloudLink="https://on.soundcloud.com/Mjina"
            />
          </Discography>
        }
      />
    </div>
  );
};

PlatinumRoses.propTypes = {
  i: PropTypes.number,
  expanded: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
};
