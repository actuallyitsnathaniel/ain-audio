import { memo } from "react";

import { Project } from "../../../components/project";
import SEO from "../../../components/seo";
import Discography from "../../../components/discography";

import rileyPfp from "/src/assets/images/projects/riley/riley.jpg";
import losingHearts from "/src/assets/images/projects/riley/Singles_EPs/losing-hearts.jpg";
import iWas9Remix from "/src/assets/images/projects/riley/Singles_EPs/i-was-9-remix.png";
import better from "/src/assets/images/projects/riley/Singles_EPs/better.jpeg";
import starsRemix from "/src/assets/images/projects/riley/Singles_EPs/stars-remix.jpeg";
import withTheRain from "/src/assets/images/projects/riley/Singles_EPs/with-the-rain.jpeg";

// Define the type for a release
interface Release {
  node: {
    artist: {
      name: string;
    };
    title: string;
    id: string;
  };
}

export const Riley = memo(
  ({ id, isStandalone = false }: { id: string; isStandalone?: boolean }) => {
    const Title = (
      <Project.Title artistName="riley" subtitle="artist" {...{ id }} />
    );

    return (
      <div {...{ id }}>
        <SEO
          title="riley - Artist Project"
          description="riley is Nathaniel Bowman's personal passion project. Produced, mixed, and mastered original music ranging from heavy bass to somber songwriting."
          url="https://audio.actuallyitsnathaniel.com/projects/riley"
          type="music.album"
          jsonLd={{
            "@context": "https://schema.org",
            "@type": "MusicGroup",
            name: "riley",
            description:
              "Personal passion project by actually-its-nathaniel featuring original music production, mixing, and mastering.",
            url: "https://audio.actuallyitsnathaniel.com/projects/riley",
          }}
        />
        <Project.ProfilePic
          {...{ id }}
          image={rileyPfp}
          titleComponent={Title}
          isStandalone={isStandalone}
        />
        <Project
          {...{ id }}
          titleComponent={Title}
          isStandalone={isStandalone}
          description={
            <>
              My personal passion project. Produced, mixed, and mastered by me.
              Ranging in styles from heavy bass-hitters like&nbsp;
              <a
                rel="noopener noreferrer"
                target="_blank"
                className="text-cyan-500"
                href="https://g.co/kgs/5jXm9e3"
              >
                Virtual Riot
              </a>
              &nbsp;all the way to somber songwriters like&nbsp;
              <a
                rel="noopener noreferrer"
                target="_blank"
                className="text-cyan-500"
                href="https://g.co/kgs/4UAgqwW"
              >
                Emmit Fenn
              </a>
              . Take a look around, stay a while!
            </>
          }
          works={
            <>
              <Discography>
                <Discography.Disc
                  artwork={withTheRain}
                  releaseType="single"
                  title="With the Rain"
                  appleMusicLink="https://music.apple.com/us/album/with-the-rain-feat-riley-single/1790476408"
                  spotifyLink="https://open.spotify.com/track/2SaapkvKlKTbhrcQpROGAT?si=6728999cee3d4cc7"
                  tidalLink=""
                  youtubeLink="https://www.youtube.com/watch?v=s5ZICMn1k80"
                />
                <Discography.Disc
                  artwork={starsRemix}
                  releaseType="single"
                  title="Stars (riley remix)"
                  appleMusicLink="https://music.apple.com/us/album/stars-riley-remix/1660688944?i=1660688945"
                  spotifyLink="https://open.spotify.com/track/29NlMvw2a5h7o5sCqgJ7K3?si=f8ae2b4e9aa145b1"
                  tidalLink=""
                  youtubeLink="https://www.youtube.com/watch?v=9z8t3nt7ZmA"
                />
                <Discography.Disc
                  artwork={iWas9Remix}
                  title="I Was 9 (riley remix)"
                  releaseType="single"
                  appleMusicLink="https://music.apple.com/us/album/i-was-9-riley-remix/1649318275?i=1649318276"
                  spotifyLink="https://open.spotify.com/track/3F87Dak8Q41QSNbJfA6AMx?si=14fdcbed18374a3e"
                  tidalLink="https://tidal.com/browse/album/253512701"
                  youtubeLink="https://youtu.be/CsQ9kl_a1Y4?si=DOJsUs4qZvEmiplA"
                />
                <Discography.Disc
                  artwork={better}
                  title="Better (with John White and riley)"
                  releaseType="single"
                  appleMusicLink="https://music.apple.com/us/album/better-single/1556313448"
                  spotifyLink="https://open.spotify.com/track/52lu5hXrnYdWtPb90ImyA6?si=84018c33fb16478d"
                  tidalLink="https://tidal.com/browse/track/244622029"
                  youtubeLink="https://youtu.be/YkTWodHhM0o?si=ANBcBe_cGghTjFpJ"
                />
                <Discography.Disc
                  artwork={losingHearts}
                  title="john white x riley - Losing Hearts"
                  releaseType="single"
                  appleMusicLink="https://music.apple.com/us/album/losing-hearts-feat-john-white/1509147409?i=1509147412"
                  spotifyLink="https://open.spotify.com/track/3lLtkLtBztQd8DiLCAORH5?si=f55f60cc305049c8"
                  youtubeLink="https://youtu.be/AloaubmwGEA?si=Mn_ZeImQwfpXb_z8"
                  soundcloudLink="https://on.soundcloud.com/qEY7u"
                />
              </Discography>
            </>
          }
        ></Project>
      </div>
    );
  },
);
