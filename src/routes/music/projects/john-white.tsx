import { Project } from "../../../components/project";
import Discography from "../../../components/discography";
import SoundXYZGallery from "../../../components/sound-xyz";

import johnWhitePfp from "/src/assets/images/projects/john-white/johnWhitePfp.jpeg";

// EPs
import fakeSmilesEP from "/src/assets/images/projects/john-white/Singles_EPs/fake_smiles_ep600x600bb.jpeg";
import starsRemix from "/src/assets/images/projects/john-white/Singles_EPs/stars_remix_600x600bb.jpeg";

// Singles
import whoeverYouWantToBeSingle from "/src/assets/images/projects/john-white/Singles_EPs/whoever_you_want_to_be_single_600x600bb.jpeg";
import better2021Single from "/src/assets/images/projects/john-white/Singles_EPs/better_2021_single_600x600bb.jpeg";

export const JohnWhite = ({ id }: { id: string }) => {
  const Title = (
    <Project.Title
      artistName={"John White"}
      subtitle={"singer/songwriter/producer"}
    />
  );
  return (
    <div {...{ id }}>
      <Project.ProfilePic
        {...{ id }}
        image={johnWhitePfp}
        titleComponent={Title}
      />
      <Project
        {...{ id }}
        titleComponent={Title}
        // TODO: description, socials
        description={
          <>
            One of my longest collaborators and dearest friends. I&apos;ve
            produced, mixed, remixed, and mastered a number of songs for him,
            and continue to do so all the time.
          </>
        }
        works={
          <>
            <SoundXYZGallery>
              <SoundXYZGallery.Item
                id="better"
                soundURL={
                  "https://embed.sound.xyz/v1/release/6df2b4c4-6aeb-47a5-bb6c-a34b117a2ab3?referral=0x35493e493e0d2001eda31bd7fb8859f961a227ce&referral_source=embed-sound"
                }
              />
              <SoundXYZGallery.Item
                soundURL={
                  "https://embed.sound.xyz/v1/release/f547e1ea-7570-48fd-b044-3fa516ba016d?referral=0x35493e493e0d2001eda31bd7fb8859f961a227ce&referral_source=embed-sound"
                }
              />
              <SoundXYZGallery.Item
                soundURL={
                  "https://embed.sound.xyz/v1/release/0c5ac231-2ae7-4118-9531-2b36056b66a0?referral=0x35493e493e0d2001eda31bd7fb8859f961a227ce&referral_source=embed-sound"
                }
              />
            </SoundXYZGallery>
            <h1 className="p-5 m-5">general releases</h1>
            <Discography>
              <Discography.Disc
                releaseType="single"
                artwork={fakeSmilesEP}
                title={"betchu wish u could take it back"}
                spotifyLink={
                  "https://open.spotify.com/album/5xG9WKhRF1ve48GMnDdInB?si=7y49yfvlRNqACC7uECI88g"
                }
                appleMusicLink={
                  "https://embed.music.apple.com/us/album/fake-smiles-ep/1678254661"
                }
                soundcloudLink={
                  "https://soundcloud.com/johnwhitesmusic/fake-smiles-mixmaster-1"
                }
                youtubeLink={
                  "https://youtube.com/playlist?list=olak5uy_m2wbnwqklx4ez6u2smtzdiqnx5nsflqbi"
                }
              />
              <Discography.Disc
                releaseType="single"
                artwork={starsRemix}
                title={"stars (riley remix)"}
                spotifyLink={
                  "https://open.spotify.com/track/29NlMvw2a5h7o5sCqgJ7K3?si=4c5c7aacc383407a"
                }
                appleMusicLink={
                  "https://music.apple.com/us/album/stars-riley-remix-single/1660688944"
                }
                soundcloudLink={""}
                youtubeLink={"https://youtu.be/9z8t3nt7zma"}
              />
              <Discography.Disc
                releaseType="single"
                artwork={whoeverYouWantToBeSingle}
                title={"whoever you want to be - single"}
                spotifyLink={
                  "https://open.spotify.com/track/42W4JMlVCjf41SmqcimLhz?si=e40a72ca719e4625"
                }
                appleMusicLink={
                  "https://music.apple.com/us/album/whoever-you-want-to-be-single/1630867196"
                }
                soundcloudLink={
                  "https://soundcloud.com/johnwhitesmusic/johnwhite-whoeveryouwanttobe"
                }
                youtubeLink={"https://youtu.be/toxcnzk9xoo"}
              />
              <Discography.Disc
                releaseType="single"
                artwork={better2021Single}
                title={"better (with sam denton & riley) - single (2021)"}
                spotifyLink={
                  "https://open.spotify.com/track/52lu5hXrnYdWtPb90ImyA6?si=112307d4c45a4830"
                }
                appleMusicLink={
                  "https://music.apple.com/us/album/better-single/1556313448"
                }
                soundcloudLink={""}
                youtubeLink={"https://youtu.be/yktwodhhm0o"}
              />
            </Discography>
          </>
        }
      />
    </div>
  );
};
