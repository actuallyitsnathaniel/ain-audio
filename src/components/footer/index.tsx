import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 text-white text-center p-6">
      <p className="flex-1 md:max-w-xs md:text-left text-sm text-white/70 normal-case">
        actually-its-nathaniel&rsquo;s music is not licensed for AI or machine
        learning training. Any violation of this policy will be pursued to the
        fullest extent of the law.{" "}
        <Link
          className="italic underline underline-offset-2 text-purple-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
          to="/usage-and-ai-policy"
        >
          Read the usage &amp; AI policy
        </Link>
        .
      </p>
      <p className="flex-1 md:text-base lowercase">
        <span>
          Built with&nbsp;
          <a
            className="italic underline underline-offset-2 text-purple-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
            href="https://vitejs.dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Vite
          </a>
          &nbsp;+&nbsp;
          <a
            className="italic underline underline-offset-2 text-cyan-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
            href="https://react.dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            React
          </a>
          &nbsp; and&nbsp;
          <a
            className="italic underline underline-offset-2 text-blue-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
            href="https://tailwindcss.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            TailwindCSS
          </a>
          . maintained by&nbsp;
          <a
            className="italic underline underline-offset-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
            href="mailto:nathanielrbowman@gmail.com"
          >
            me
          </a>
          .
        </span>
      </p>
      <p className="flex-1 md:max-w-xs md:text-right text-sm text-white/70 normal-case">
        Copyright © {new Date().getFullYear()} Nathaniel Riley Bowman. All
        rights reserved.
      </p>
    </footer>
  );
};

export default Footer;
