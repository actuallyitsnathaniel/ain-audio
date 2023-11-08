import AppleMusicSVG from "../../../assets/images/icons/music-platforms/apple-music.svg";

const AppleMusicLink = () => {
  return (
    <a
      className="transition-all duration-100 p-2 md:hover:-translate-y-2"
      href=""
      target="_blank"
      rel="noopener noreferrer"
    >
      <img
        src={AppleMusicSVG}
        className="transition-all duration-75 h-12 w-auto rounded-[13px] hover:scale-110 hover:bg-gradient-to-b from-[#fa57c1] via-[#b166cc] to-[#69a6f9]"
        alt="apple-music-alt"
      />
    </a>
  );
};

export default AppleMusicLink;