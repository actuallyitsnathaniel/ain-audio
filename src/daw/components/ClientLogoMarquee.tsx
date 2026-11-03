import adidas from "/src/assets/images/clients/adidas.png";
import aubit from "/src/assets/images/clients/aubit.png";
import brandX from "/src/assets/images/clients/brand-x.png";
import evabeat from "/src/assets/images/clients/evabeat.png";
import jlm from "/src/assets/images/clients/jlm.png";
import netflix from "/src/assets/images/clients/netflix.png";
import primeVideo from "/src/assets/images/clients/prime-video.png";

/** All marks are white-on-transparent PNG32 — one monochrome strip on the dark panel. */
const logos = [
  { src: adidas, alt: "Adidas", className: "h-9 w-auto max-w-[6.5rem] object-contain" },
  { src: netflix, alt: "Netflix", className: "h-7 w-auto max-w-[8rem] object-contain" },
  { src: primeVideo, alt: "Prime Video", className: "h-8 w-auto max-w-[9.5rem] object-contain" },
  { src: evabeat, alt: "EVAbeat", className: "h-9 w-auto max-w-[7.5rem] object-contain" },
  { src: jlm, alt: "Jessica Lea Mayfield", className: "h-9 w-auto max-w-[11rem] object-contain" },
  { src: brandX, alt: "Brand X Music", className: "h-7 w-auto max-w-[11rem] object-contain" },
  { src: aubit, alt: "Aubit Sound", className: "h-7 w-auto max-w-[9rem] object-contain" },
] as const;

function LogoSet({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <ul className="client-marquee-set m-0 list-none" aria-hidden={ariaHidden || undefined}>
      {logos.map((logo) => (
        <li key={logo.alt} className="flex h-10 shrink-0 items-center">
          <img
            src={logo.src}
            alt={ariaHidden ? "" : logo.alt}
            className={`${logo.className} opacity-80`}
            draggable={false}
          />
        </li>
      ))}
    </ul>
  );
}

/** Infinite horizontal logo strip — selected client marks. */
export function ClientLogoMarquee() {
  return (
    <div className="w-full border-y border-line py-4">
      <p className="m-0 mb-3 font-mono text-[10px] tracking-[0.14em] text-faint uppercase">
        Selected work
      </p>
      <div
        className="client-marquee relative overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, #000 8%, #000 92%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, #000 8%, #000 92%, transparent)",
        }}
      >
        {/* Two identical sets; translateX(-50%) lands exactly on the seam. */}
        <div className="client-marquee-track flex w-max">
          <LogoSet />
          <LogoSet ariaHidden />
        </div>
      </div>
    </div>
  );
}
