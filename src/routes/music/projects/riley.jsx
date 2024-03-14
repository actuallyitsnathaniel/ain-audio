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
        // TODO: description, socials
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
            . You&nbsp;ll notice there are general releases, and then special
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
            <div id="sound-xyz-releases">
              <h1 className="p-5">sound.xyz</h1>
              <div className="flex w-fit mx-auto p-5 bg-gray-500 rounded-lg bg-opacity-25 content-between gap-10">
                <iframe
                  src="https://embed.sound.xyz/v1/release/324ade13-93db-4f39-8f38-bb99b6085e07?referral=0x35493e493e0d2001eda31bd7fb8859f961a227ce&referral_source=embed-sound"
                  className="rounded-lg w-auto h-48"
                  allow="clipboard-write"
                  sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                ></iframe>
              </div>
            </div>
            <h1 className="p-5 m-5">general releases</h1>
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
                soundcloudLink="https://on.soundcloud.com/qEY7u"
              />
            </Discography>
          </>
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
