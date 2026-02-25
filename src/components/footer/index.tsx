const Footer = () => {
  return (
    <footer className="flex flex-wrap text-white text-center justify-center items-center p-6 h-24">
      <p className="grid md:text-md lowercase">
        <span>
          <br />
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
        Copyright © {new Date().getFullYear()} Nathaniel Bowman.
      </p>
    </footer>
  );
};

export default Footer;
