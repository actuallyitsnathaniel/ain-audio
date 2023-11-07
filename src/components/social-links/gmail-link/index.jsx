import GmailColorSVG from "../../../assets/images/icons/gmail-color.svg";

const GmailLogo = () => {
  return (
    <a
      className="transition-all duration-100 p-3 md:hover:-translate-y-2 group"
      href="mailto:nathanielrbowman@gmail.com"
      target="_blank"
      rel="noopener noreferrer"
    >
      <img
        src={GmailColorSVG}
        className="h-16 saturate-0 hover:saturate-100 contrast-[150%] to-black hover:contrast-100 transition ease-in-out duration-100 hover:scale-110 "
      />
    </a>
  );
};

export default GmailLogo;
