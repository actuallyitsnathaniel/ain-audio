import { Project } from "../../../components/project";
import Discography from "../../../components/discography";
import SEO from "../../../components/seo";

import brandXBlue from "/src/assets/images/projects/brandx/brand-x-blue.jpg";

import spiraling from "/src/assets/images/projects/brandx/works/norml-spiraling_600x600bb.jpg";
import popFestVol2 from "/src/assets/images/projects/brandx/works/popfest-vol2-600x600bb.jpg";
import tomsDinerCover from "/src/assets/images/projects/brandx/works/toms-diner-cover.png";

export const BrandX = ({ id }: { id: string }) => {
  const Title = (
    <Project.Title artistName={"Brand X"} subtitle={"sync/label"} />
  );
  return (
    <div {...{ id }}>
      <SEO
        title="Brand X Music - Sync/Label"
        description="Songs and demos produced for Brand X Music catalogue. Music for film scores, commercials, and video games."
        url="https://audio.actuallyitsnathaniel.com/#projects/brand-x"
        type="website"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Organization",
          "name": "Brand X Music",
          "description": "Sync licensing and music library featuring production work by actually-its-nathaniel.",
          "url": "https://audio.actuallyitsnathaniel.com/#projects/brand-x"
        }}
      />
      <Project.ProfilePic
        {...{ id }}
        image={brandXBlue}
        titleComponent={Title}
      />
      <Project
        {...{ id }}
        titleComponent={Title}
        // TODO: description, socials
        description={
          <>
            I wrote and produced a number of songs and demos for this
            company&apos;s catalogue, which you&apos;ll see below. BXM has
            continually released amazing collections across all of their
            catalogs. Their work is heard across many different mediums. Film
            scores, commercials, and video games to name a few. The company
            performs all operations in-house, has a rock star team, and has
            grown into something that two musicians could never have imagined.
            Brand X Music was and still is a composer owned library and strives
            to make the highest quality music available on the market.
          </>
        }
        works={
          <Discography>
            <Discography.Disc
              releaseType="general"
              artwork={spiraling}
              title="Spiraling (from Spiraling EP)"
              spotifyLink="https://open.spotify.com/track/2GUzeTEMKnWAjMWYA1Ui4V?si=5c39d40150734f62"
              youtubeLink="https://www.youtube.com/watch?v=AfTfGX5Wvrg&list=OLAK5uy_lhtTc3b8h0HPzM8iobZ40xmw4Cn38tGos"
              appleMusicLink="https://music.apple.com/us/album/spiraling/1668083016?i=1668083021"
            />
            <Discography.Disc
              releaseType="general"
              artwork={tomsDinerCover}
              title="Tom's Diner (from Mixtape)"
              spotifyLink="https://open.spotify.com/track/4zBtv57k0H4dFcvSZSWDla?si=3ba3c0c6c8fe445f"
              youtubeLink="https://www.youtube.com/watch?v=H8iVHmDxlBk"
              appleMusicLink="https://music.apple.com/id/album/toms-diner/1705680543?i=1705680547"
            />
            <Discography.Disc
              releaseType="general"
              artwork={popFestVol2}
              title="Don't Pretend (from Popfest Vol. 2)"
              spotifyLink="https://open.spotify.com/track/63SLRotYth5eukYcJw0Trt?si=939f1c747cb14117"
              youtubeLink="https://www.youtube.com/watch?v=bjuaf-LfdWg"
              appleMusicLink="https://music.apple.com/us/album/dont-pretend/1692907111?i=1692907112"
            />
          </Discography>
        }
      />
    </div>
  );
};
