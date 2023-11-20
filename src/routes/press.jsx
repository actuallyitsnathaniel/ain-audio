import { PressLink } from "../components/press-link";

export const Press = () => {
  return (
    <div id="press">
      <h1>Press</h1>
      <h3 className="text-center py-5 underline text-5xl font-extrabold">
        press highlights
      </h3>
      <a href="" target="_blank" rel="noreferrer noopener">
        Shoutout LA
      </a>

      <PressLink
        href={
          "https://shoutoutla.com/meet-nathaniel-bowman-software-audio-engineer/"
        }
        title={"Meet Nathaniel Bowman | Software & Audio Engineer"}
        subtitle={"write-up by Shoutout LA"}
      />
    </div>
  );
};
