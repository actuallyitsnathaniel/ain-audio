import { PressLink } from "/src/components/press-link";

const Press = () => {
  return (
    <div
      id="press"
      className="p-5 flex flex-col justify-center h-full md:pt-16"
    >
      <h1 className="text-5xl top-0 p-5 underline">press</h1>
      <div className="flex justify-center my-auto">
        <PressLink
          href={
            "https://shoutoutla.com/meet-nathaniel-bowman-software-audio-engineer/"
          }
          title={"Meet Nathaniel Bowman | Software & Audio Engineer"}
          subtitle={"write-up by Shoutout LA"}
        />
      </div>
    </div>
  );
};

export default Press;
