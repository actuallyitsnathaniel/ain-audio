const Footer = () => {
  return (
    <footer className="flex flex-wrap text-white text-center justify-center items-center p-3 h-24">
      <p className="grid md:text-md lowercase">
        Copyright © {new Date().getFullYear()} Nathaniel Bowman. Built with
        Vite + React and TailwindCSS. powered by{" "}
        <span>
          <a
            className="underline underline-offset-8 "
            href="mailto:nathanielrbowman@gmail.com"
          >
            myself
          </a>
          .
        </span>
      </p>
    </footer>
  );
};

export default Footer;
