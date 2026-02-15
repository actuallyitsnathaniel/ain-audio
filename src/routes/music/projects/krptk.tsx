import { Project } from "../../../components/project";
import Discography from "../../../components/discography";
import SEO from "../../../components/seo";

// import krptkLogo from "/src/assets/images/projects/krptk/krptk_logo.jpg";
import krptkPfp from "/src/assets/images/projects/krptk/krptk_pfp.jpg";
import howULikeThatRemix from "/src/assets/images/projects/krptk/discography/how-u-like-that-remix.png";
import luvMe from "/src/assets/images/projects/krptk/discography/luv_me_single-600x600bb.jpg";
import knotionzVol1 from "/src/assets/images/projects/krptk/discography/knotionz_vol1_EP-600x600bb.jpg";
import over from "/src/assets/images/projects/krptk/discography/over_single-600x600bb.jpg";
import kintsugi from "/src/assets/images/projects/krptk/discography/kintsugi_single-600x600bb.jpg";

export const KRPTK = ({ id }: { id: string }) => {
  const Title = (
    <Project.Title artistName={"KRPTK"} subtitle={"singer/songwriter"} />
  );
  return (
    <div id="krptk">
      <SEO
        title="KRPTK - Singer/Songwriter"
        description="KRPTK is a Korean American R&B/Hip Hop musician and visual artist. All songs produced, mixed, and mastered by Nathaniel Bowman."
        url="https://audio.actuallyitsnathaniel.com/#projects/krptk"
        type="music.album"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "MusicGroup",
          "name": "KRPTK",
          "description": "Korean American R&B/Hip Hop musician with production by actually-its-nathaniel.",
          "genre": ["R&B", "Hip Hop"],
          "url": "https://audio.actuallyitsnathaniel.com/#projects/krptk"
        }}
      />
      <Project.ProfilePic {...{ id }} image={krptkPfp} titleComponent={Title} />
      <Project
        {...{ id }}
        titleComponent={Title}
        // TODO: description, socials
        description={
          <>
            I produced, mixed, and mastered all the songs you see here. KRPTK is
            a family friend and incredibly skilled songwriter with an ear for
            excellence.
            <br />
            <br />
            cryp·tic /ˈkriptik/ hip hop | rnb | everything in between. a
            neurotic musician | visual artist. korean american | socal native
            KRPTK is a Korean American R&B/Hip Hop musician and cinematic artist
            from Southern California. His duality as a musician and visual
            artist drives and inspires his art. In 2020, KRPTK set out on his
            own journey as a music artist to create a haven for the mentally
            afflicted and chase after something meaningful. His message is hope
            and his standard is substance. He now utilizes his background and
            experience as a Director, DP, Producer, and Editor to tell his
            visual narrative and build his story from the ground up.
          </>
        }
        works={
          <Discography>
            <Discography.Disc
              releaseType="single"
              title="Kintsugi - Single"
              artwork={kintsugi}
              spotifyLink="https://open.spotify.com/track/3uLhL3hk0rRo9w5L00Qn96?si=67a52b363d6744d4"
              youtubeLink="https://www.youtube.com/watch?v=1z1o5ZM_DnU"
              appleMusicLink="https://music.apple.com/us/album/kintsugi/1620459267?i=1620459520"
              tidalLink="https://tidal.com/browse/track/225869369"
            />
            <Discography.Disc
              releaseType="single"
              title="Over - Single"
              artwork={over}
              spotifyLink="https://open.spotify.com/track/0J6iZXCOKn1cOD1GmlPSsv?si=a2546d14824a4940"
              youtubeLink="https://www.youtube.com/watch?v=ZXffX5yiey4"
              appleMusicLink="https://music.apple.com/us/album/over/1657955629?i=1657955630"
              tidalLink="https://tidal.com/browse/track/264432077"
            />
            <Discography.Disc
              releaseType="ep"
              title="Knotionz Vol.1 - EP"
              artwork={knotionzVol1}
              spotifyLink="https://open.spotify.com/album/3aYf5U7SebWREMihnVyksc?si=46bvcOuhQYW4TqboM0J6Qw"
              youtubeLink="https://www.youtube.com/watch?v=r65-6pplMmk"
              appleMusicLink="https://music.apple.com/us/album/knotionz-vol-1-single/1656560644"
              tidalLink="https://tidal.com/browse/album/262949063"
            />
            <Discography.Disc
              releaseType="single"
              title="Luv Me - Single"
              artwork={luvMe}
              spotifyLink="https://open.spotify.com/track/1yJa71ZQLwCk6lXHkQnuUx?si=013086c1398b4cc0"
              youtubeLink="https://www.youtube.com/watch?v=SL1276GEgl0"
              appleMusicLink="https://music.apple.com/us/album/luv-me/1656552144?i=1656552147"
              tidalLink="https://tidal.com/browse/track/262939586"
            />
            <Discography.Disc
              releaseType="single"
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
