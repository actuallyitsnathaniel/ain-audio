const GmailLink = ({ href }: { href: string }) => {
  return (
    <a
      className="transition-all duration-100 p-2 md:hover:-translate-y-2 group"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 51 51"
        height="75px"
        width="75px"
        className="h-12 w-auto saturate-0 hover:saturate-100 contrast-[150%] to-black hover:contrast-100 transition ease-in-out duration-100 hover:scale-110"
      >
        <rect width="51" height="51" rx="14.2" fill="white" />
        <g transform="translate(2.7 2.5) scale(0.94 0.94)">
          <path
            fill="#4caf50"
            d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z"
          />
          <path
            fill="#1e88e5"
            d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z"
          />
          <polygon
            fill="#e53935"
            points="35,11.2 24,19.45 13,11.2 12,17 13,23.7 24,31.95 35,23.7 36,17"
          />
          <path
            fill="#c62828"
            d="M3,12.298V16.2l10,7.5V11.2L9.876,8.859C9.132,8.301,8.228,8,7.298,8h0C4.924,8,3,9.924,3,12.298z"
          />
          <path
            fill="#fbc02d"
            d="M45,12.298V16.2l-10,7.5V11.2l3.124-2.341C38.868,8.301,39.772,8,40.702,8h0 C43.076,8,45,9.924,45,12.298z"
          />
        </g>
      </svg>
    </a>
  );
};

export default GmailLink;
