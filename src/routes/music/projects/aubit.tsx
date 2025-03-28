import { Project } from "../../../components/project";
import Discography from "../../../components/discography";

import aubitLogo from "/src/assets/images/projects/aubit-sound/aubit-logo.jpg";

// discography
import odessaVol3 from "/src/assets/images/projects/aubit-sound/discography/odessa-vol-3.jpg";
import awake from "/src/assets/images/projects/aubit-sound/discography/awake-vol-1.jpg";
import garryx from "/src/assets/images/projects/aubit-sound/discography/garryx-for-serum-vol-1.jpg";
import broox from "/src/assets/images/projects/aubit-sound/discography/broox-bounce-vol-1.jpg";
import chainPop from "/src/assets/images/projects/aubit-sound/discography/chain-pop-vol-1.jpg";
import ultralleniumVoxChops from "/src/assets/images/projects/aubit-sound/discography/ultrallenium-vox-chops-col-1.jpg";
import the1975 from "/src/assets/images/projects/aubit-sound/discography/1975-for-serum.jpg";
import grayVol2 from "/src/assets/images/projects/aubit-sound/discography/gray-vol-2.jpg";
import plumeVol1 from "/src/assets/images/projects/aubit-sound/discography/plume-vol-1.jpg";
import louv from "/src/assets/images/projects/aubit-sound/discography/louv-vol-1.jpg";
import grayVol1 from "/src/assets/images/projects/aubit-sound/discography/gray-vol-1.jpg";
import jaccForMassive from "/src/assets/images/projects/aubit-sound/discography/jacc-for-massive-vol-1.jpg";
import odessaVol2 from "/src/assets/images/projects/aubit-sound/discography/odessa-vol-2.jpg";
import masaVoxChopsVol1 from "/src/assets/images/projects/aubit-sound/discography/masa-vox-chops-vol-1.jpg";
import petitVoxChopsVol1 from "/src/assets/images/projects/aubit-sound/discography/petit-vox-chops-vol-1.jpg";
import snakesForSerumVol1 from "/src/assets/images/projects/aubit-sound/discography/snakes-for-serum-vol-1.jpg";

export const AubitSound = ({ id }: { id: string }) => {
  const Title = (
    <Project.Title
      artistName={"Aubit Sound"}
      subtitle="sample/sound library company"
    />
  );
  return (
    <div {...{ id }}>
      <Project.ProfilePic
        {...{ id }}
        image={aubitLogo}
        titleComponent={Title}
      />
      <Project
        {...{ id }}
        titleComponent={Title}
        description={
          <>
            From late 2018 to late 2019, I put together a prolific number of
            &apos;producer-packs&apos; for this company that consists of
            presets, loops, and one-shots. Nearly every pack I created became a
            number one best-seller for over two weeks across multiple marketing
            platforms, the largest being&nbsp;
            <a
              rel="noopener noreferrer"
              target="_blank"
              className="text-cyan-500"
              href="https://www.adsrsounds.com/vendor/aubit-sound/"
            >
              ADSRSounds.com
            </a>
            . I created a few demos to showcase some of them, but not very many.
            These packs have been used by a large number of successful artists
            including:&nbsp;
            {
              <a
                rel="noopener noreferrer"
                target="_blank"
                className="text-cyan-500"
                href="https://g.co/kgs/X5MFGzh"
              >
                Cheat Codes
              </a>
            }
            ,&nbsp;
            {
              <a
                rel="noopener noreferrer"
                target="_blank"
                className="text-cyan-500"
                href="https://g.co/kgs/vyvKs9c"
              >
                U2
              </a>
            }
            ,&nbsp;
            {
              <a
                rel="noopener noreferrer"
                target="_blank"
                className="text-cyan-500"
                href="https://g.co/kgs/BZHpVZF"
              >
                Virginia to Vegas
              </a>
            }
            , and countless others. You can access the store page and support
            that company via the pics below. I also recorded a large number of
            layman&apos;s tutorials involving these packs, teaching concepts
            such as basic theory, sound design, and music production techniques.
            You can find those&nbsp;
            <a
              rel="noopener noreferrer"
              target="_blank"
              className="text-cyan-500"
              href="https://www.youtube.com/watch?v=mNc0PhQsJvc&list=PLhrkYXXSZxDXJ5WzwQXLdivnkSH8JF78n"
            >
              here
            </a>
            .
          </>
        }
        works={
          <Discography>
            <Discography.Disc
              releaseType="general"
              artwork={odessaVol3}
              title={"ODESSA Vol. 3"}
              webLink={"https://www.aubitsound.com/soundbanks/odessa-vol-3"}
              youtubeLink={"https://www.youtube.com/watch?v=_gMnFRN7WDw"}
            />
            <Discography.Disc
              releaseType="general"
              artwork={garryx}
              title={"Garyx Vol. 1"}
              soundcloudLink={
                "https://soundcloud.com/synthpresets/aubit-sound-garyx-vol-1-serum-presets-midi-samples"
              }
              webLink={"https://www.aubitsound.com/soundbanks/garyx-vol-1"}
              youtubeLink={"https://www.youtube.com/watch?v=SMjeEuZqL04"}
            />
            <Discography.Disc
              releaseType="general"
              artwork={grayVol2}
              title={"Gray Vol. 2"}
              webLink={"https://www.aubitsound.com/soundbanks/gray-vol-2"}
              soundcloudLink={"https://soundcloud.com/aubitofficial/gray-vol-2"}
            />
            <Discography.Disc
              releaseType="general"
              artwork={louv}
              title={"Louv Vol. 1"}
              webLink={"https://www.aubitsound.com/soundbanks/louv-vol-1"}
              soundcloudLink={"https://soundcloud.com/aubitofficial/louv-vol-1"}
            />
            <Discography.Disc
              releaseType="general"
              artwork={plumeVol1}
              title={"Plume Vol. 1"}
              webLink={"https://www.aubitsound.com/soundbanks/plume-vol-1"}
              soundcloudLink={
                "https://soundcloud.com/aubitofficial/plume-vol-1"
              }
            />
            <Discography.Disc
              releaseType="general"
              artwork={grayVol1}
              title={"Gray Vol. 1"}
              webLink={"https://www.aubitsound.com/soundbanks/gray-vol-1"}
              soundcloudLink={"https://soundcloud.com/aubitofficial/gray-vol-1"}
            />
            <Discography.Disc
              releaseType="general"
              artwork={chainPop}
              title={"Chain-Pop Vol. 1"}
              soundcloudLink={
                "https://soundcloud.com/aubitofficial/chain-pop-vol-1"
              }
              webLink={"https://www.aubitsound.com/soundbanks/chain-pop-vol-1"}
              youtubeLink={"https://www.youtube.com/watch?v=2Nxc97Dsnws"}
            />

            <Discography.Disc
              releaseType="general"
              artwork={snakesForSerumVol1}
              title={"Snakes for Serum Vol. 1"}
              soundcloudLink={
                "https://soundcloud.com/flp-family/25-free-dj-snake-style-presets"
              }
              webLink={"https://www.aubitsound.com/soundbanks/snakes-for-serum"}
              youtubeLink={"https://www.youtube.com/watch?v=rwza_-8Dwik"}
            />
            <Discography.Disc
              releaseType="general"
              artwork={broox}
              title={"Broox Bounce Vol. 1"}
              soundcloudLink={"https://on.soundcloud.com/fm3dn"}
              webLink={
                "https://www.adsrsounds.com/product/presets/broox-bounce-vol-1/"
              }
              youtubeLink={"https://www.youtube.com/watch?v=hit_3cN9z6g"}
            />
            <Discography.Disc
              releaseType="general"
              artwork={masaVoxChopsVol1}
              title={"Masa Vocal Chops"}
              webLink={"https://www.aubitsound.com/soundbanks/masa-vocal-chops"}
              youtubeLink={"https://www.youtube.com/watch?v=JEnpus1ksqw"}
            />
            <Discography.Disc
              releaseType="general"
              artwork={petitVoxChopsVol1}
              youtubeLink={"https://www.youtube.com/watch?v=-QoPWwA8gZs"}
              webLink={
                "https://www.aubitsound.com/soundbanks/petit-vocal-chops-vol-1"
              }
            />
            <Discography.Disc
              releaseType="general"
              artwork={awake}
              title={"Awake Vol. 1"}
              webLink={"https://www.aubitsound.com/soundbanks/awake-vol-1"}
              youtubeLink={"https://www.youtube.com/watch?v=yULUwFa1cTg"}
            />
            <Discography.Disc
              releaseType="general"
              artwork={the1975}
              title={"1975 for Serum"}
              webLink={"https://www.aubitsound.com/soundbanks/1975-for-serum"}
              youtubeLink={"https://www.youtube.com/watch?v=BoVvdXQ39DA"}
            />
            <Discography.Disc
              releaseType="general"
              artwork={ultralleniumVoxChops}
              title={"Ultrallenium Vocal Chops"}
              webLink={
                "https://www.aubitsound.com/soundbanks/ultrallenium-vocal-chops"
              }
              soundcloudLink={
                "https://soundcloud.com/aubitofficial/ultrallenium-vocal-chops"
              }
            />
            <Discography.Disc
              releaseType="general"
              artwork={jaccForMassive}
              title={"Jacc for Massive Vol. 1"}
              webLink={"https://www.aubitsound.com/soundbanks/jacc-for-massive"}
              youtubeLink={"https://www.youtube.com/watch?v=cJp_3U7y6Yo"}
            />
            <Discography.Disc
              releaseType="general"
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
