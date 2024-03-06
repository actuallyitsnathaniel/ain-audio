import rileyBGMP4 from "/src/assets/videos/riley-bg.mp4";
// import rileyBGWEBM from "/src/assets/videos/riley-bg.webm";

const VideoBG = () => {
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
      className="min-w-full top-0 w-full h-full object-cover scale-110 fixed z-[-1] overflow-clip flex saturate-[15%] brightness-[0.12] blur-sm bg-black"
    >
      <source src={rileyBGMP4} type="video/MP4" />
      {/* <source src={rileyBGWEBM} type="video/webm" /> */}
    </video>
  );
};

export default VideoBG;
