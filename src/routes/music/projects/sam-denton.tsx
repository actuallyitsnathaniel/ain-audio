import React, { useEffect, useState } from "react";

import { Project } from "../../../components/project";
import Discography from "../../../components/discography";
import SoundXYZGallery from "../../../components/sound-xyz";

import { soundXyzReleases } from "../../../api/getSoundXYZdata";

import samPfp from "/src/assets/images/projects/sam-denton/sam-denton-pfp.jpg";
// albums
import forNow from "/src/assets/images/projects/sam-denton/LPs/for_now_600x600bb.jpeg";
// singles
import backToYou from "/src/assets/images/projects/sam-denton/Singles_EPs/back_to_you_600x600bb.jpeg";
import idkya from "/src/assets/images/projects/sam-denton/Singles_EPs/idkya_600x600bb.jpeg";
import _209 from "/src/assets/images/projects/sam-denton/Singles_EPs/2_09_600x600bb.jpeg";
import smokeInTheMirror from "/src/assets/images/projects/sam-denton/Singles_EPs/smoke_in_the_mirror_600x600bb.jpeg";
import iJustMight from "/src/assets/images/projects/sam-denton/Singles_EPs/i_just_might_600x600bb.jpeg";
import first from "/src/assets/images/projects/sam-denton/Singles_EPs/first_600x600bb.jpeg";
import better from "/src/assets/images/projects/sam-denton/Singles_EPs/better_2021_single_600x600bb.jpeg";
import dreams from "/src/assets/images/projects/sam-denton/Singles_EPs/dreams_600x600bb.jpeg";

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

export const SamDenton = ({ id }: { id: string }) => {
  const [samDentonReleases, setSamDentonReleases] = useState<string[]>([]);
  const Title = (
    <Project.Title artistName="Sam Denton" subtitle="singer/songwriter" />
  );

  // Filter SoundXYZ releases for Sam Denton
  useEffect(() => {
    const fetchReleases = async () => {
      try {
        const releases: Release[] = await soundXyzReleases;
        const filteredReleases = releases
          .filter((release) => release.node.artist.name === "Sam Denton")
          .map((release) => release.node.id);
        setSamDentonReleases(filteredReleases);
      } catch (error) {
        console.error("Error fetching sound.xyz releases:", error);
      }
    };

    fetchReleases();
  }, []);

  return (
    <div {...{ id }}>
      <Project.ProfilePic {...{ id }} image={samPfp} titleComponent={Title} />
      <Project
        {...{ id }}
        titleComponent={Title}
        description={
          <>
            A dear friend and talented singer/songwriter and designer. Very
            proud to say I&apos;ve produced, mixed, and mastered every work you
            see on this page. We&apos;re currently writing more, so be on the
            lookout for more releases!
          </>
        }
        works={
          <>
            <Discography>
              <Discography.Disc
                releaseType="ep"
                artwork={forNow}
                title={"for now,"}
                spotifyLink={
                  "https://open.spotify.com/album/41VQPdMsvw0bLKRAiQ0dsL?si=j5K5fDzhSACNNMooWrQAOQ"
                }
                appleMusicLink={
                  "https://music.apple.com/ph/album/for-now/1476295406"
                }
                tidalLink={"https://tidal.com/browse/album/245469084"}
                soundcloudLink={""}
                youtubeLink={""}
              />

              <Discography.Disc
                releaseType="single"
                artwork={dreams}
                title="dreams"
                spotifyLink="https://open.spotify.com/track/5X0UGqgAEsG0YWGtkqtvBt?si=0a9f3e0664a54c9a"
                appleMusicLink="https://music.apple.com/us/album/dreams/1573467286?i=1573467301"
                tidalLink="https://tidal.com/browse/track/243956491"
                soundcloudLink={""}
                youtubeLink="https://www.youtube.com/watch?v=lA42ghfjvCo"
              />
              <Discography.Disc
                releaseType="single"
                artwork={better}
                title="better (with riley & john white)"
                spotifyLink="https://open.spotify.com/track/52lu5hXrnYdWtPb90ImyA6?si=d8d3dedf5e23468b"
                appleMusicLink="https://music.apple.com/us/album/better/1556313448?i=1556313450"
                tidalLink="https://tidal.com/browse/track/244622029"
                soundcloudLink={""}
                youtubeLink="https://www.youtube.com/watch?v=YkTWodHhM0o"
              />
              <Discography.Disc
                artwork={first}
                releaseType="single"
                title="first"
                spotifyLink="https://open.spotify.com/track/1w4i5qwiRwGOkbMxEBjfyJ?si=f040acca342a4e49"
                appleMusicLink="https://music.apple.com/us/album/first/1493852002?i=1493852052"
                tidalLink="https://tidal.com/browse/track/243488656"
                soundcloudLink={""}
                youtubeLink="https://www.youtube.com/watch?v=0QWcpO3q1kA"
              />
              <Discography.Disc
                releaseType="single"
                artwork={iJustMight}
                title="i just might."
                spotifyLink="https://open.spotify.com/track/2qazwrjvUxVr8cRSUfDJJt?si=c9166f78e2df4ce6"
                appleMusicLink="https://music.apple.com/us/album/i-just-might/1472805738?i=1472805927"
                tidalLink="https://tidal.com/browse/track/246002376"
                soundcloudLink={""}
                youtubeLink="https://www.youtube.com/watch?v=w1bNk5EvylU"
              />
              <Discography.Disc
                artwork={smokeInTheMirror}
                releaseType="single"
                title="smoke in the mirror (with samiere)"
                spotifyLink="https://open.spotify.com/track/6hwmodBKdK50qtvvIPU2kT?si=6803c09fc91d47a5"
                appleMusicLink="https://music.apple.com/us/album/smoke-in-the-mirror-with-samiere/1466027622?i=1466027633"
                tidalLink="https://tidal.com/browse/track/245912176"
                soundcloudLink={""}
                youtubeLink="https://www.youtube.com/watch?v=DiubEmfg1oM"
              />
              <Discography.Disc
                artwork={_209}
                title="2:09"
                releaseType="single"
                spotifyLink="https://open.spotify.com/track/0dhX55OSXJdHfqeNxt4jNg?si=723c5458a64b484d"
                appleMusicLink="https://music.apple.com/us/album/2-09/1451819059?i=1451819133"
                tidalLink={"https://tidal.com/browse/track/246154538"}
                soundcloudLink={"https://on.soundcloud.com/b5Cqj"}
                youtubeLink={"https://www.youtube.com/watch?v=LWqM12QvhXw"}
              />
              <Discography.Disc
                artwork={idkya}
                releaseType="single"
                title={"idkya"}
                spotifyLink={
                  "https://open.spotify.com/track/7L8IiYRiALjOpeaAuCIbdq?si=dbac34fcc4e8436c"
                }
                appleMusicLink={
                  "https://music.apple.com/us/album/idkya/1442630949?i=1442631257"
                }
                tidalLink={"https://tidal.com/browse/track/243348992"}
                soundcloudLink={"https://on.soundcloud.com/1eR4x"}
                youtubeLink={"https://www.youtube.com/watch?v=bUUB3sBHwyA"}
              />
              <Discography.Disc
                artwork={backToYou}
                releaseType="single"
                title={"back to you"}
                spotifyLink={
                  "https://open.spotify.com/track/7rTbCF7hmnxpiJwQWGiyK5?si=77e1816ad74d4f30"
                }
                appleMusicLink={
                  "https://music.apple.com/us/album/back-to-you-single/1437900119"
                }
                tidalLink={"https://tidal.com/browse/track/242202178"}
                soundcloudLink={"https://on.soundcloud.com/XoZGT"}
                youtubeLink={"https://www.youtube.com/watch?v=5Cqq5n7153A"}
              />
            </Discography>
            <SoundXYZGallery>
              {samDentonReleases.map((releaseId: string) => (
                <SoundXYZGallery.Item
                  key={releaseId}
                  soundURL={`https://embed.sound.xyz/v1/release/${releaseId}?referral=0x35493e493e0d2001eda31bd7fb8859f961a227ce&referral_source=embed-sound`}
                />
              ))}
            </SoundXYZGallery>
          </>
        }
      />
    </div>
  );
};
