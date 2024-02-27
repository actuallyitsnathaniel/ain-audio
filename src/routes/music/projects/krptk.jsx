import { PropTypes } from "prop-types";
import { ProfilePic, Project, Title } from "/src/components/project";
import Discography from "/src/components/discography";

// import krptkLogo from "/src/assets/images/projects/krptk/krptk_logo.jpg";
import krptkPfp from "/src/assets/images/projects/krptk/krptk_pfp.jpg";
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
        image={krptkPfp}
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
              spotifyLink="https://open.spotify.com/track/3uLhL3hk0rRo9w5L00Qn96?si=67a52b363d6744d4"
              youtubeLink="https://www.youtube.com/watch?v=1z1o5ZM_DnU"
              appleMusicLink="https://music.apple.com/us/album/kintsugi/1620459267?i=1620459520"
              tidalLink="https://tidal.com/browse/track/225869369"
            />
            <Discography.Disc
              title="Over - Single"
              artwork={over}
              spotifyLink="https://open.spotify.com/track/0J6iZXCOKn1cOD1GmlPSsv?si=a2546d14824a4940"
              youtubeLink="https://www.youtube.com/watch?v=ZXffX5yiey4"
              appleMusicLink="https://music.apple.com/us/album/over/1657955629?i=1657955630"
              tidalLink="https://tidal.com/browse/track/264432077"
            />
            <Discography.Disc
              title="Knotionz Vol.1 - EP"
              artwork={knotionzVol1}
              spotifyLink="https://open.spotify.com/album/3aYf5U7SebWREMihnVyksc?si=46bvcOuhQYW4TqboM0J6Qw"
              youtubeLink="https://www.youtube.com/watch?v=r65-6pplMmk"
              appleMusicLink="https://music.apple.com/us/album/knotionz-vol-1-single/1656560644"
              tidalLink="https://tidal.com/browse/album/262949063"
            />
            <Discography.Disc
              title="Luv Me - Single"
              artwork={luvMe}
              spotifyLink="https://open.spotify.com/track/1yJa71ZQLwCk6lXHkQnuUx?si=013086c1398b4cc0"
              youtubeLink="https://www.youtube.com/watch?v=SL1276GEgl0"
              appleMusicLink="https://music.apple.com/us/album/luv-me/1656552144?i=1656552147"
              tidalLink="https://tidal.com/browse/track/262939586"
            />
            <Discography.Disc
              title="BLACKPINK - How You Like That (KRPTK REMIX Cover)"
              artwork={howULikeThatRemix}
              youtubeLink="https://www.youtube.com/watch?v=oGntp56pPL8"
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
