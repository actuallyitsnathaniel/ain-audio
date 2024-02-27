import { PropTypes } from "prop-types";
import { ProfilePic, Project, Title } from "/src/components/project";
import Discography from "/src/components/discography";

import platinumRoses from "/src/assets/images/projects/platinum-roses/platinum-roses.jpeg";
import oneThingIKnow from "/src/assets/images/projects/platinum-roses/discography/one-thing-i-know-single.jpg";
import whatdIDo from "/src/assets/images/projects/platinum-roses/discography/whatd-i-do-single.jpg";
import contemplate from "/src/assets/images/projects/platinum-roses/discography/contemplate-single.jpg";

// eslint-disable-next-line no-unused-vars
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
        discography={
          <Discography>
            <Discography.Disc
              title="Contemplate - single"
              artwork={contemplate}
              spotifyLink=""
              youtubeLink=""
              appleMusicLink=""
              tidalLink=""
            />
            <Discography.Disc
              title="What'd I Do - single"
              artwork={whatdIDo}
              spotifyLink=""
              youtubeLink=""
              appleMusicLink=""
              tidalLink=""
            />
            <Discography.Disc
              title="One Thing I Know - single"
              artwork={oneThingIKnow}
              spotifyLink=""
              youtubeLink=""
              appleMusicLink=""
              tidalLink=""
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
