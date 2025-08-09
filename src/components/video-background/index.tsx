import rileyBGMP4 from "/src/assets/videos/riley-bg.mp4";
// import rileyBGWEBM from "/src/assets/videos/riley-bg.webm";

const VideoBG = () => {
  const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    console.log('Video failed to load, applying fallback background');
    const video = e.currentTarget;
    video.style.display = 'none';
    
    // Create fallback div
    const fallback = document.createElement('div');
    fallback.className = 'min-w-full top-0 w-full h-full fixed z-[-1] bg-gradient-to-br from-gray-900 via-black to-gray-800';
    video.parentElement?.appendChild(fallback);
  };

  return (
    <div className="fixed top-0 left-0 w-full h-full z-[-1]">
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
        onError={handleVideoError}
        className="min-w-full top-0 w-full h-full object-cover scale-110 fixed z-[-1] overflow-clip flex saturate-[30%] brightness-[0.3] blur-sm bg-gray-900"
      >
        <source src={rileyBGMP4} type="video/MP4" />
        {/* <source src={rileyBGWEBM} type="video/webm" /> */}
      </video>
      {/* Fallback background for mobile/Arc Search */}
      <div className="min-w-full top-0 w-full h-full fixed z-[-2] bg-gradient-to-br from-gray-900 via-black to-gray-800 md:hidden" />
    </div>
  );
};

export default VideoBG;
