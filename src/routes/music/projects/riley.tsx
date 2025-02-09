import { useEffect, useState } from "react";

import { Project } from "../../../components/project";
import Discography from "../../../components/discography";
import SoundXYZGallery from "../../../components/sound-xyz";
import { soundXyzReleases } from "../../../api/getSoundXYZdata";

import rileyPfp from "/src/assets/images/projects/riley/riley.jpg";
import losingHearts from "/src/assets/images/projects/riley/Singles_EPs/losing-hearts.jpg";
import iWas9Remix from "/src/assets/images/projects/riley/Singles_EPs/i-was-9-remix.png";
import better from "/src/assets/images/projects/riley/Singles_EPs/better.jpeg";
import starsRemix from "/src/assets/images/projects/riley/Singles_EPs/stars-remix.jpeg";

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

export const Riley = ({ id }: { id: string }) => {
  const [rileyReleases, setRileyReleases] = useState<string[]>([]);

  useEffect(() => {
    const fetchReleases = async () => {
      try {
        const releases: Release[] = await soundXyzReleases;
        const filteredReleases = releases
          .filter(
            (release) =>
              release.node.artist.name === "riley" ||
              release.node.artist.name === "Sam Denton"
          )
          .map((release) => release.node.id);
        setRileyReleases(filteredReleases);
      } catch (error) {
        console.error("Error fetching sound.xyz releases:", error);
      }
    };

    fetchReleases();
  }, []);

  const Title = (
    <Project.Title artistName="riley" subtitle="artist" {...{ id }} />
  );

  console.log("XYZ: ", rileyReleases);
  // soundXyzReleases.map((release) => {
  //   if (release.node.artist.name === "riley" || release.node.title === "better")
  //     rileyReleases.push(release.node.id);
  // });

  return (
    <div {...{ id }}>
      <Project.ProfilePic {...{ id }} image={rileyPfp} titleComponent={Title} />
      <Project
        {...{ id }}
        titleComponent={Title}
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
            . You&apos;ll notice there are general releases, and then special
            releases through an exclusive digital audio platform,&nbsp;
            <a
              rel="noopener noreferrer"
              target="_blank"
              className="text-cyan-500"
              href="https://www.sound.xyz/actuallyitsnathaniel/releases"
            >
              sound.xyz
            </a>
            !&nbsp; Take a look around, stay a while!
          </>
        }
        works={
          <>
            <Discography>
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
            <SoundXYZGallery>
              {rileyReleases.map((release) => (
                <SoundXYZGallery.Item
                  key={release}
                  soundURL={`https://embed.sound.xyz/v1/release/${release}?referral=0x35493e493e0d2001eda31bd7fb8859f961a227ce&referral_source=embed-sound`}
                />
              ))}
            </SoundXYZGallery>
          </>
        }
      ></Project>
    </div>
  );
};
