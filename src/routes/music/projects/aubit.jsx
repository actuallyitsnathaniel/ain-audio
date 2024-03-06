import { PropTypes } from "prop-types";
import { ProfilePic, Project, Title } from "/src/components/project";
import Discography from "/src/components/discography";

import aubitLogo from "/src/assets/images/projects/aubit-sound/aubit-logo.jpg";

import odessaVol3 from "/src/assets/images/projects/aubit-sound/discography/odessa-vol-3.jpg";
import odessaVol2 from "/src/assets/images/projects/aubit-sound/discography/odessa-vol-2.jpg";
import awake from "/src/assets/images/projects/aubit-sound/discography/awake-vol-1.jpg";
import the1975 from "/src/assets/images/projects/aubit-sound/discography/1975-for-serum.jpg";

// broox
// chain-pop
// garryx
// jacc
// louv
// masa
// petit
// plume
// snakes
// gray 2
// gray 1
// ultrallenium

// eslint-disable-next-line no-unused-vars
export const AubitSound = ({ i, expanded, HandleActiveArtist }) => {
  return (
    <div id="aubit-sound">
      <ProfilePic
        i={i}
        image={aubitLogo}
        {...{ expanded, HandleActiveArtist }}
        titleComponent={
          <Title
            artistName={"Aubit Sound"}
            subtitle="sample/sound library company"
          />
        }
      />
      <Project
        {...{ i, expanded, HandleActiveArtist }}
        titleComponent={
          <Title
            artistName={"Aubit Sound"}
            subtitle="sample/sound library company"
          />
        }
        discography={
          <Discography>
            <Discography.Disc
              artwork={odessaVol3}
              title={"ODESSA Vol. 3"}
              webLink={"https://www.aubitsound.com/soundbanks/odessa-vol-3"}
              youtubeLink={"https://www.youtube.com/watch?v=_gMnFRN7WDw"}
            />
            <Discography.Disc
              artwork={awake}
              title={"Awake Vol. 1"}
              webLink={"https://www.aubitsound.com/soundbanks/awake-vol-1"}
              youtubeLink={"https://www.youtube.com/watch?v=yULUwFa1cTg"}
            />
            <Discography.Disc
              artwork={the1975}
              title={"1975 for Serum"}
              webLink={"https://www.aubitsound.com/soundbanks/1975-for-serum"}
              youtubeLink={"https://www.youtube.com/watch?v=BoVvdXQ39DA"}
            />
            <Discography.Disc
              artwork={odessaVol2}
              title={"ODESSA Vol. 2"}
              webLink={
                "https://www.aubitsound.com/soundbanks/odessa-ultimate-soundset-vol-2"
              }
              soundcloudLink={
                "https://soundcloud.com/aubitofficial/odessa-ultimate-soundset-vol-2"
              }
            />
          </Discography>
        }
      />
    </div>
  );
};

AubitSound.propTypes = {
  i: PropTypes.number,
  expanded: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
};
