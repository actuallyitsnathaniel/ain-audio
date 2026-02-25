import { Project } from "../../../components/project";
import Discography from "../../../components/discography";
import SEO from "../../../components/seo";

import platinumRoses from "/src/assets/images/projects/platinum-roses/platinum-roses.jpeg";
import oneThingIKnow from "/src/assets/images/projects/platinum-roses/discography/one-thing-i-know-single.jpg";
import whatdIDo from "/src/assets/images/projects/platinum-roses/discography/whatd-i-do-single.jpg";
import contemplate from "/src/assets/images/projects/platinum-roses/discography/contemplate-single.jpg";

export const PlatinumRoses = ({ id, isStandalone = false }: { id: string; isStandalone?: boolean }) => {
  const Title = (
    <Project.Title
      artistName={"Platinum Roses"}
      subtitle={"songwriter/producer duo"}
    />
  );
  return (
    <div {...{ id }}>
      <SEO
        title="Platinum Roses - Songwriter/Producer Duo"
        description="Platinum Roses electronic music duo featuring John White. All tracks produced, mixed, and mastered by Nathaniel Bowman."
        url="https://audio.actuallyitsnathaniel.com/projects/platinum-roses"
        type="music.album"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "MusicGroup",
          "name": "Platinum Roses",
          "description": "Electronic music songwriter/producer duo with production by actually-its-nathaniel.",
          "genre": "Electronic",
          "url": "https://audio.actuallyitsnathaniel.com/#projects/platinum-roses"
        }}
      />
      <Project.ProfilePic
        {...{ id }}
        image={platinumRoses}
        titleComponent={Title}
        isStandalone={isStandalone}
      />
      <Project
        {...{ id }}
        titleComponent={Title}
        isStandalone={isStandalone}
        descriptionLength={408}
        // TODO: description, socials
        description={
          <>
            I was a producer / co-songwriter in this duo, and it gained a decent
            amount of traction before the collaborator and I split to focus on
            our individual projects. You may recognize the voice in this
            project. None other than John White himself! I&apos;m proud of the
            work that&apos;s come out of this collaboration, it serves as a
            testament to my standards for professional electronic music. All
            produced, mixed and mastered by me.
          </>
        }
        works={
          <Discography>
            <Discography.Disc
              releaseType="single"
              title="Contemplate - single"
              artwork={contemplate}
              spotifyLink="https://open.spotify.com/track/2ELwGfn2Csr7g6xo41ijtG?si=dc09680c17bd4fc6"
              youtubeLink="https://youtu.be/vxj_UcpPxaw?si=poVRRqn0C2k0dMyn"
              appleMusicLink="https://music.apple.com/us/album/contemplate-single/1445320598"
              soundcloudLink="https://on.soundcloud.com/7eKxH"
            />
            <Discography.Disc
              releaseType="single"
              title="What'd I Do - single"
              artwork={whatdIDo}
              spotifyLink="https://open.spotify.com/track/5kj8UE9PJWi1eMKRPKAzsL?si=a9a879f0b8054fa5"
              youtubeLink="https://youtu.be/fzHnkK12r_U?si=6rVEtnHLg0Z_twLF"
              appleMusicLink="https://music.apple.com/us/album/whatd-i-do-single/1362745750"
              soundcloudLink="https://on.soundcloud.com/kATbu"
            />
            <Discography.Disc
              releaseType="single"
              title="One Thing I Know - single"
              artwork={oneThingIKnow}
              spotifyLink="https://open.spotify.com/track/7gXk8WVfiAitbPjDSTv0L8?si=9da86dab6c694505"
              youtubeLink="https://youtu.be/2rWabGeJPUA?si=SpETE2jfm1LocQMe"
              appleMusicLink="https://music.apple.com/us/album/one-thing-i-know-single/1320562860"
              soundcloudLink="https://on.soundcloud.com/Mjina"
            />
          </Discography>
        }
      />
    </div>
  );
};
