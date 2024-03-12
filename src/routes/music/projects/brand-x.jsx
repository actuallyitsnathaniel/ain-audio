import { PropTypes } from "prop-types";
import { ProfilePic, Project, Title } from "/src/components/project";
import Discography from "/src/components/discography";

import brandXBlue from "/src/assets/images/projects/brandx/brand-x-blue.jpg";

import spiraling from "/src/assets/images/projects/brandx/works/norml-spiraling_600x600bb.jpg";
import popFestVol2 from "/src/assets/images/projects/brandx/works/popfest-vol2-600x600bb.jpg";
import tomsDinerCover from "/src/assets/images/projects/brandx/works/toms-diner-cover.png";

export const BrandX = ({ i, expanded, HandleActiveArtist }) => {
  return (
    <div id="brand-x">
      <ProfilePic
        i={i}
        image={brandXBlue}
        {...{ expanded, HandleActiveArtist }}
        titleComponent={
          <Title artistName={"Brand X"} subtitle={"sync/label"} />
        }
      />
      <Project
        {...{ i, expanded, HandleActiveArtist }}
        titleComponent={
          <Title artistName={"Brand X"} subtitle={"sync/label"} />
        }
        // TODO: description, socials
        description={
          <>
            John Sponsler and Tom Gire met nearly 25 years ago through a mutual
            friend. By combining focus and talents, they have gone from
            struggling musicians to owners of a premiere music library for
            entertainment. With work ranging from feature films and major
            trailers to assisting John Williams on Memoirs of a Geisha, the two
            also published tracks they had written together under Brand X Music.
            While working at RCP for Hans Zimmer on the Pirates franchise, the
            duo still managed to secure placements for dozens of blockbusters,
            promos, and video games through BXM which was now becoming a serious
            contender in the industry. In 2012, John and Tom left film music and
            launched three new Brand X Music catalogs to service in-program and
            promo needs.
            <br />
            <br />
            The company grew relationships at major entertainment companies
            while producing some of the most in-demand theatrical advertising
            music available. As awareness, public interest, and global use of
            the Brand X Music catalog grew, the company continued to raise the
            bar on trailer music and land epic placements. With a renewed focus
            on in-program, streaming, and video game licensing, BXM has
            continually released amazing collections across all of their
            catalogs. The company now performs all operations in-house, has a
            rock star team, and has grown into something that two musicians
            could never have imagined. Brand X Music was and still is a composer
            owned library and strives to make the highest quality music
            available on the market.
          </>
        }
        works={
          <Discography>
            <Discography.Disc
              artwork={spiraling}
              title="Spiraling (from Spiraling EP)"
              spotifyLink="https://open.spotify.com/track/2GUzeTEMKnWAjMWYA1Ui4V?si=5c39d40150734f62"
              youtubeLink="https://www.youtube.com/watch?v=AfTfGX5Wvrg&list=OLAK5uy_lhtTc3b8h0HPzM8iobZ40xmw4Cn38tGos"
              appleMusicLink="https://music.apple.com/us/album/spiraling/1668083016?i=1668083021"
            />
            <Discography.Disc
              artwork={tomsDinerCover}
              title="Tom's Diner (from Mixtape)"
              spotifyLink="https://open.spotify.com/track/4zBtv57k0H4dFcvSZSWDla?si=3ba3c0c6c8fe445f"
              youtubeLink="https://www.youtube.com/watch?v=H8iVHmDxlBk"
              appleMusicLink="https://music.apple.com/id/album/toms-diner/1705680543?i=1705680547"
            />
            <Discography.Disc
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

BrandX.propTypes = {
  i: PropTypes.number,
  expanded: PropTypes.number,
  HandleActiveArtist: PropTypes.func,
};
