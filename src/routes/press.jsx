import { PressLink } from "/src/components/press-link";

const Press = () => {
  return (
    <div
      id="press"
      className="p-5 flex flex-col justify-center h-full md:pt-16"
    >
      <h1 className="py-5 flex flex-wrap justify-center text-5xl underline">
        press
      </h1>
      <div className="flex flex-wrap justify-center my-auto gap-y-10">
        <PressLink
          href={
            "https://voyagela.com/interview/conversations-with-nate-bowman/"
          }
          title={"Conversations with Nate Bowman"}
          subtitle={"Write-up by Voyage LA"}
        />
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
