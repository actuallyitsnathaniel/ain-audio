import rileyBGMP4 from "../../assets/videos/riley-bg.mp4";
import rileyBGWEBM from "../../assets/videos/riley-bg.webm";

const VideoBG = () => {
  // TODO: better video in ableton...
  return (
    <video
      height={"110%"}
      width={"auto"}
      id="video"
      rel="preload"
      autoPlay
      loop
      muted
      playsInline
      disablePictureInPicture
      className="min-w-full top-0 w-full h-full object-cover scale-110 fixed z-[-1] overflow-clip flex brightness-[0.09] blur-sm bg-black"
    >
      <source src={rileyBGMP4} type="video/MP4" />
      <source src={rileyBGWEBM} type="video/webm" />
    </video>
  );
};

export default VideoBG;
