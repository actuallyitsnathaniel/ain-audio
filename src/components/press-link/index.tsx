export const PressLink = ({
  href,
  title,
  subtitle,
}: {
  href: string;
  title: string;
  subtitle: string;
}) => {
  return (
    <div>
      <div className="flex md:transition md:duration-75 md:ease-in-out md:hover:scale-110 max-w-sm">
        <a
          className="font-semibold text-xl focus:outline-none focus-visible:underline focus-visible:decoration-white focus-visible:underline-offset-4"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          &quot;{title}&quot;
        </a>
      </div>
      <p className="text-lg italic">{subtitle}</p>
    </div>
  );
};
