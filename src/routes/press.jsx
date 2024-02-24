import { PressLink } from "/src/components/press-link";

const Press = () => {
  return (
    <div
      id="press"
      className="p-5 flex flex-col justify-center min-h-screen md:pt-16"
    >
      <h1 className="text-4xl">press</h1>
      <h3 className="text-center py-5 underline text-3xl font-bold">
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

export default Press;
