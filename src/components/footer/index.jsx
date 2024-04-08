const Footer = () => {
  return (
    <footer className="flex flex-wrap text-white text-center justify-center items-center p-6 h-24">
      <p className="grid md:text-md lowercase">
        <span>
          <br />
          Built with{" "}
          <a
            className="italic underline underline-offset-2 text-purple-500"
            href="https://vitejs.dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Vite
          </a>{" "}
          +{" "}
          <a
            className="italic underline underline-offset-2 text-cyan-300"
            href="https://react.dev/"
            target="_blank"
            rel="noopener noreferrer"
          >
            React
          </a>{" "}
          and{" "}
          <a
            className="italic underline underline-offset-2 text-blue-500"
            href="https://tailwindcss.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            TailwindCSS
          </a>
          . maintained by{" "}
          <a
            className="italic underline underline-offset-2"
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
