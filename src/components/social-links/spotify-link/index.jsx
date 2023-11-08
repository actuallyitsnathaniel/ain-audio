import SpotifySVG from "../../../assets/images/icons/music-platforms/spotify.svg";

const SpotifyLink = () => {
  return (
    <a
      className="transition-all duration-100 p-2 md:hover:-translate-y-2"
      href=""
      target="_blank"
      rel="noopener noreferrer"
    >
      <img
        src={SpotifySVG}
        loading="lazy"
        className="transition-all duration-75 h-12 rounded-full hover:scale-110 hover:fill-[#1DB954]"
        alt="spotify-alt"
      />
    </a>
  );
};

export default SpotifyLink;