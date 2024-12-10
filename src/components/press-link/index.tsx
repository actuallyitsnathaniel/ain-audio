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
    <div id="press-link">
      <div className="flex md:transition md:duration-75 md:ease-in-out md:hover:scale-110 max-w-sm">
        <a className="font-semibold text-xl" href={href}>
          &quot;{title}&quot;
        </a>
      </div>
      <p className="text-lg italic">{subtitle}</p>
    </div>
  );
};
