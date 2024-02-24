import { PropTypes } from "prop-types";
import { ProfilePic, Project, Title } from "/src/components/project";
import Discography from "/src/components/discography";

import krptkLogo from "/src/assets/images/projects/krptk/ktptk_logo.jpg";
import howULikeThatRemix from "/src/assets/images/projects/krptk/discography/how-u-like-that-remix.png";
import luvMe from "/src/assets/images/projects/krptk/discography/luv_me_single-600x600bb.jpg";
import knotionzVol1 from "/src/assets/images/projects/krptk/discography/knotionz_vol1_EP-600x600bb.jpg";
import over from "/src/assets/images/projects/krptk/discography/over_single-600x600bb.jpg";
import kintsugi from "/src/assets/images/projects/krptk/discography/kintsugi_single-600x600bb.jpg";

export const KRPTK = ({ i, expanded, HandleActiveArtist }) => {
  return (
    <div id="krptk">
      <ProfilePic
        i={i}
        image={krptkLogo}
        {...{ expanded, HandleActiveArtist }}
        titleComponent={
          <Title artistName={"KRPTK"} subtitle={"singer/songwriter"} />
        }
      />
      <Project
        {...{ i, expanded, HandleActiveArtist }}
        titleComponent={
          <Title artistName={"KRPTK"} subtitle={"singer/songwriter"} />
        }
        discography={
          <Discography>
            <Discography.Disc
              title="Kintsugi - Single"
              artwork={kintsugi}
              spotifyLink=""
              youtubeLink=""
              appleMusicLink=""
              tidalLink=""
            />
            <Discography.Disc
              title="Over - Single"
              artwork={over}
              spotifyLink=""
              youtubeLink=""
              appleMusicLink=""
              tidalLink=""
            />
            <Discography.Disc
              title="Knotionz Vol.1 - EP"
              artwork={knotionzVol1}
              spotifyLink=""
              youtubeLink=""
              appleMusicLink=""
              tidalLink=""
            />
            <Discography.Disc
              title="Luv Me - Single"
              artwork={luvMe}
              spotifyLink=""
              youtubeLink=""
              appleMusicLink=""
              tidalLink=""
            />
            <Discography.Disc
              title="BLACKPINK - How You Like That (KRPTK REMIX Cover)"
              artwork={howULikeThatRemix}
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

KRPTK.propTypes = {
  i: PropTypes.number,
  expanded: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
};
