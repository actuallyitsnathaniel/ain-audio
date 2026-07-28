import { useState } from "react";
import { motion } from "framer-motion";

import { DawShell } from "../daw/DawShell";
import { TrackSection } from "../daw/components/TrackSection";
import { SectionHead } from "../daw/components/SectionHead";
import SEO from "../components/seo";
import heroPhoto from "../assets/images/event-photos/ryland-21.jpg";
import actionPhoto from "../assets/images/event-photos/6-29-19-6.jpg";
import { fadeUp, stagger } from "../lib/animation";

const ctaAccent =
  "px-8 py-3 rounded-[3px] border border-accent bg-accent text-[#111] text-lg font-semibold " +
  "transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_85%,white)] " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
const ctaBtn =
  "px-8 py-3 rounded-[3px] border border-line2 bg-panel text-dim text-lg font-semibold " +
  "transition-colors duration-150 hover:border-dim hover:bg-panel2 hover:text-daw-text " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

// ─── Hero ────────────────────────────────────────────────────────────────────

const Hero = () => (
  <TrackSection
    id="hero"
    label="hero"
    rail="00"
    className="min-h-[calc(100vh-52px)] content-start pt-30"
  >
    <motion.div
      className="mx-auto flex flex-col md:flex-row items-center gap-12 max-w-5xl w-full"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      {/* Text */}
      <div className="flex flex-col items-center md:items-start gap-6 text-center md:text-left flex-1">
        <motion.p
          className="font-mono text-[12px] tracking-[0.08em] text-accent"
          variants={fadeUp}
        >
          DJ · MC · Event Audio Professional
        </motion.p>
        <motion.h1
          className="text-5xl md:text-7xl font-extrabold tracking-[-0.03em] leading-none"
          variants={fadeUp}
        >
          your event,
          <br />
          perfectly scored.
          <span className="cursor-blink font-normal text-accent">_</span>
        </motion.h1>
        <motion.p
          className="text-lg md:text-xl text-dim max-w-lg"
          variants={fadeUp}
        >
          professional DJ and MC services for weddings, corporate events, and
          private parties — los angeles & beyond.
        </motion.p>
        <motion.a
          href="mailto:nathanielrbowman@gmail.com?subject=DJ%20%2F%20MC%20Booking%20Inquiry"
          className={"mt-4 " + ctaAccent}
          variants={fadeUp}
        >
          book nathaniel
        </motion.a>
      </div>
      {/* Photo */}
      <motion.div
        className="flex-1 w-full max-w-sm md:max-w-none rounded-sm border border-line2 bg-panel p-2"
        variants={fadeUp}
      >
        <img
          src={heroPhoto}
          alt="Nathaniel Bowman running audio at a live event"
          className="w-full h-120 object-cover object-top grayscale-20 rounded-xs"
        />
      </motion.div>
    </motion.div>
  </TrackSection>
);

// ─── Services ────────────────────────────────────────────────────────────────

const services = [
  {
    title: "weddings",
    icon: "♡",
    description:
      "From the ceremony processional to the last song of the night, every moment is curated with intention. Seamless transitions, MC announcements, and a dance floor that keeps going.",
    details: [
      "ceremony & cocktail hour",
      "reception & grand entrance",
      "first dance, toasts & send-off",
      "custom playlist collaboration",
    ],
  },
  {
    title: "corporate events",
    icon: "◈",
    description:
      "Setting the right tone for galas, product launches, holiday parties, and team events. Professional, polished, and adaptable to any brand or vibe.",
    details: [
      "company parties & galas",
      "product launches & brand events",
      "award ceremonies",
      "background & ambient sets",
    ],
  },
  {
    title: "private parties",
    icon: "✦",
    description:
      "Birthday celebrations, quinceañeras, anniversaries, or just a good time — bring the energy of a professional DJ to any private occasion.",
    details: [
      "birthday & milestone parties",
      "quinceañeras & sweet 16s",
      "house parties & rooftop events",
      "themed & custom experiences",
    ],
  },
];

const Services = () => (
  <TrackSection id="services" label="services" rail="01">
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: false, margin: "-80px" }}
      variants={stagger}
      className="flex flex-col gap-8"
    >
      <motion.div variants={fadeUp}>
        <SectionHead num="01" title="what i do" />
      </motion.div>
      <motion.div
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
        variants={stagger}
      >
        {services.map((s) => (
          <motion.div
            key={s.title}
            className="flex flex-col gap-4 rounded-sm border border-line bg-panel p-8 text-left
              transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-line2"
            variants={fadeUp}
          >
            <span className="text-3xl text-accent">{s.icon}</span>
            <h3 className="text-2xl font-bold">{s.title}</h3>
            <p className="text-dim text-sm leading-relaxed">{s.description}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {s.details.map((d) => (
                <li
                  key={d}
                  className="text-sm text-faint flex items-center gap-2"
                >
                  <span className="text-accent">—</span> {d}
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  </TrackSection>
);

// ─── Photo Divider ───────────────────────────────────────────────────────────

const PhotoDivider = () => (
  <motion.div
    className="w-full mx-auto min-h-screen border-y border-line"
    initial={{ opacity: 0 }}
    whileInView={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    viewport={{ once: false, margin: "-80px" }}
    transition={{ duration: 0.6 }}
    style={{
      maskImage:
        "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
    }}
  >
    <img
      src={actionPhoto}
      alt="Nathaniel Bowman mixing audio at a live event"
      className="w-full h-full object-cover grayscale-20"
      style={{ objectPosition: "center 75%" }}
    />
  </motion.div>
);

// ─── How It Works ────────────────────────────────────────────────────────────

const steps = [
  {
    number: "01",
    title: "reach out",
    description:
      "Send a message with your event date, venue, and vision. I'll get back to you within 24 hours to discuss availability and details.",
  },
  {
    number: "02",
    title: "plan together",
    description:
      "We'll go over your must-plays, do-not-plays, timeline, and any special moments — so everything is dialed in before the day arrives.",
  },
  {
    number: "03",
    title: "show up & deliver",
    description:
      "I arrive early, set up without fuss, and keep the energy exactly where it needs to be from start to finish.",
  },
];

const HowItWorks = () => (
  <TrackSection id="how-it-works" label="how it works" rail="02">
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: false, margin: "-80px" }}
      variants={stagger}
      className="flex flex-col gap-8"
    >
      <motion.div variants={fadeUp}>
        <SectionHead num="02" title="how it works" />
      </motion.div>
      <motion.div
        className="flex flex-col md:flex-row gap-4"
        variants={stagger}
      >
        {steps.map((step) => (
          <motion.div
            key={step.number}
            className="flex-1 flex flex-col gap-3 text-center rounded-sm border border-line bg-panel p-6"
            variants={fadeUp}
          >
            <span className="font-mono text-4xl font-bold text-faint">
              {step.number}
            </span>
            <h3 className="text-xl font-bold">{step.title}</h3>
            <p className="text-dim text-sm leading-relaxed">
              {step.description}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  </TrackSection>
);

// ─── Reviews ─────────────────────────────────────────────────────────────────

const reviews = [
  {
    name: "Joshua & Hana Harbman",
    eventType: "wedding reception",
    date: "Feb 13, 2021",
    platform: "Direct",
    quote:
      "Nate has been an extremely reliable audio support engineer across a wide range of events. I was initially exposed to his expertise as a problem solver running weekly audio for events at college for hundreds of students on an admittedly outdated and creaky system infrastructure. Never had any issues while I was on the event production team. He also ran audio at my wedding, where everything went off perfectly without a hitch. As is always the case at weddings, things inevitably go wrong, and the task of the support team is to make sure the issues never get to the bride and groom. Nate was the model of professionalism and calm, and the dance floor was popping all night!",
  },
];

const Stars = () => (
  <span
    className="text-accent text-lg tracking-wider"
    aria-label="5 out of 5 stars"
  >
    ★★★★★
  </span>
);

const Reviews = () => (
  <TrackSection id="reviews" label="reviews" rail="03">
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: false, margin: "-80px" }}
      variants={stagger}
      className="flex flex-col gap-8"
    >
      <motion.div variants={fadeUp}>
        <SectionHead num="03" title="what clients say" sub="5.0 · 1 review" />
      </motion.div>
      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 gap-6"
        variants={stagger}
      >
        {reviews.map((r, i) => (
          <motion.div
            key={i}
            className="flex flex-col gap-4 rounded-sm border border-line bg-panel p-8 text-left"
            variants={fadeUp}
          >
            <Stars />
            <p className="text-daw-text text-sm leading-relaxed italic">
              &ldquo;{r.quote}&rdquo;
            </p>
            <div className="mt-auto pt-4 border-t border-line flex justify-between items-end">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{r.name}</span>
                <span className="font-mono text-xs text-faint">
                  {r.eventType}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-mono text-xs text-faint">{r.date}</span>
                <span className="font-mono text-xs text-accent">
                  {r.platform}
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  </TrackSection>
);

// ─── FAQ ─────────────────────────────────────────────────────────────────────

const faqs = [
  {
    q: "what areas do you serve?",
    a: "I'm based in Los Angeles and available throughout Southern California — including Orange County, San Diego, the Inland Empire, and the greater LA area. I'm also open to destination events and travel bookings with advance notice.",
  },
  {
    q: "do you bring your own equipment?",
    a: "Yes — I come fully equipped with professional DJ gear including industry-standard controllers, a PA system, subwoofer, and all necessary cables. For larger venues I'm also happy to work alongside or integrate with house sound systems.",
  },
  {
    q: "are you insured?",
    a: "Yes, I carry general liability insurance and can provide a certificate of insurance to your venue upon request. Most venues require this and I'm fully prepared to meet any documentation requirements.",
  },
  {
    q: "how far in advance should i book?",
    a: "For weddings and larger events, 3–6 months in advance is recommended to secure your date. For private parties and corporate events, 4–8 weeks is usually sufficient, though I occasionally have last-minute availability — don't hesitate to reach out.",
  },
  {
    q: "can guests make song requests?",
    a: "Absolutely. I'm always open to requests and keep the guest experience at the center of every set. You'll have the final say on your playlist, and I'll work around any must-plays or do-not-plays you provide ahead of time.",
  },
  {
    q: "do you provide a contract?",
    a: "Yes — every booking is confirmed with a signed contract that covers the event details, timeline, payment terms, and cancellation policy. I believe in transparency and making sure both parties are fully protected.",
  },
];

const FAQItem = ({ q, a }: { q: string; a: string }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-line">
      <button
        className="w-full flex justify-between items-center py-5 text-left gap-4
          hover:text-dim transition-colors duration-150
          focus:outline-none focus-visible:underline focus-visible:decoration-daw-text focus-visible:underline-offset-4"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="text-base font-semibold">{q}</span>
        <span
          className={`text-accent text-xl leading-none transition-transform duration-200 ${
            open ? "rotate-45" : "rotate-0"
          }`}
        >
          +
        </span>
      </button>
      {open && (
        <motion.p
          className="pb-5 text-sm text-dim leading-relaxed"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {a}
        </motion.p>
      )}
    </div>
  );
};

const FAQ = () => (
  <TrackSection id="faq" label="faq" rail="04">
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: false, margin: "-80px" }}
      variants={stagger}
      className="flex flex-col gap-6 max-w-2xl mx-auto"
    >
      <motion.div variants={fadeUp}>
        <SectionHead num="04" title="faq" />
      </motion.div>
      <motion.div variants={fadeUp}>
        {faqs.map((item) => (
          <FAQItem key={item.q} {...item} />
        ))}
      </motion.div>
    </motion.div>
  </TrackSection>
);

// ─── Booking CTA ─────────────────────────────────────────────────────────────

const BookingCTA = () => (
  <TrackSection id="booking" label="book" rail="05">
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: false, margin: "-80px" }}
      variants={stagger}
      className="flex flex-col items-center text-center gap-6 max-w-xl mx-auto py-16"
    >
      <motion.h2
        className="text-4xl md:text-5xl font-extrabold tracking-[-0.02em]"
        variants={fadeUp}
      >
        ready to book?
      </motion.h2>
      <motion.p className="text-dim" variants={fadeUp}>
        reach out with your event date, venue, and any details you have — i'll
        get back to you within 24 hours.
      </motion.p>
      <motion.div
        className="flex flex-wrap justify-center gap-4"
        variants={fadeUp}
      >
        <a
          href="mailto:nathanielrbowman@gmail.com?subject=DJ%20%2F%20MC%20Booking%20Inquiry"
          className={ctaAccent}
        >
          email me
        </a>
        <a
          href="https://instagram.com/actuallyitsnathaniel"
          target="_blank"
          rel="noopener noreferrer"
          className={ctaBtn}
        >
          instagram
        </a>
      </motion.div>
      <motion.p
        variants={fadeUp}
        className="font-mono text-[11px] text-faint mt-2"
      >
        © {new Date().getFullYear()} nathaniel bowman ·
        audio.actuallyitsnathaniel.com/events
      </motion.p>
    </motion.div>
  </TrackSection>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

const Events = () => {
  return (
    <DawShell>
      <SEO
        title="DJ & MC Services — Weddings & Events | actuallyitsnathaniel"
        description="Professional DJ and MC services for weddings, corporate events, and private parties in Los Angeles and Southern California. 5-star reviews, fully insured, custom playlists."
        url="https://audio.actuallyitsnathaniel.com/events"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "EntertainmentBusiness",
          name: "actuallyitsnathaniel — DJ & MC Services",
          description:
            "Professional DJ and MC services for weddings, corporate events, and private parties in Los Angeles and Southern California.",
          url: "https://audio.actuallyitsnathaniel.com/events",
          telephone: "",
          email: "nathanielrbowman@gmail.com",
          areaServed: {
            "@type": "State",
            name: "California",
          },
          priceRange: "$$",
          sameAs: ["https://instagram.com/actuallyitsnathaniel"],
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: "DJ & MC Services",
            itemListElement: [
              {
                "@type": "Offer",
                itemOffered: { "@type": "Service", name: "Wedding DJ & MC" },
              },
              {
                "@type": "Offer",
                itemOffered: { "@type": "Service", name: "Corporate Event DJ" },
              },
              {
                "@type": "Offer",
                itemOffered: { "@type": "Service", name: "Private Party DJ" },
              },
            ],
          },
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: "5",
            reviewCount: "4",
            bestRating: "5",
          },
        }}
      />
      <main className="relative z-1">
        <Hero />
        <Services />
        <PhotoDivider />
        <HowItWorks />
        <Reviews />
        <FAQ />
        <BookingCTA />
      </main>
    </DawShell>
  );
};

export default Events;
