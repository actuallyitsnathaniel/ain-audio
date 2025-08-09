import React, { useState, useRef, useEffect, memo } from "react";

const Item = memo(({ soundURL, id }: { soundURL: string; id?: string }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="absolute inset-0 bg-gradient-to-tl from-black rounded-lg w-72 h-48" />
      {shouldLoad ? (
        <iframe
          ref={iframeRef}
          src={soundURL}
          onLoad={() => setIsLoaded(true)}
          id={id}
          className={`rounded-lg w-72 h-48 ${
            !isLoaded && "bg-[url('/src/assets/images/icons/loading.svg')]"
          } bg-no-repeat bg-center relative`}
          allow="clipboard-write"
          sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"
          loading="lazy"
        />
      ) : (
        <div className="rounded-lg w-72 h-48 bg-gray-800 flex items-center justify-center relative">
          <span className="text-gray-400">Loading...</span>
        </div>
      )}
    </div>
  );
});

// TODO: figure out why suspense isn't working ?
// https://arc.net/l/quote/yurqdzxu
// const Loading = () => {
//   return <h2>⏲ Loading...</h2>;
// };

const SoundXYZGallery = ({ children }: { children: JSX.Element[] }) => {
  return (
    <div id="sound-xyz-releases" className="p-5 md:px-28">
      <h1 className="p-5">digital collectibles</h1>
      <div
        className="flex flex-wrap justify-center mx-auto w-fit 
               p-5 bg-gray-500 rounded-lg bg-opacity-25 content-between gap-10"
      >
        {React.Children.map(children, (child, i) => {
          return React.cloneElement(child, { i });
        })}
      </div>
    </div>
  );
};

SoundXYZGallery.Item = Item;

export default SoundXYZGallery;
