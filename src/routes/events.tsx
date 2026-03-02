import { useState } from "react";
import { motion } from "framer-motion";

import { NavBar } from "../components/navbar";
import Footer from "../components/footer";
import VideoBG from "../components/video-background";
import SEO from "../components/seo";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
};

// ─── Hero ────────────────────────────────────────────────────────────────────

const Hero = () => (
  <section className="flex flex-col items-center justify-center min-h-screen text-center px-6 pt-24 pb-16">
    <motion.div
      className="flex flex-col items-center gap-6 max-w-2xl"
      initial="hidden"
      animate="visible"
      variants={stagger}
    >
      <motion.p
        className="text-sm uppercase tracking-widest text-cyan-500 font-light"
        variants={fadeUp}
      >
        DJ · MC · Events
      </motion.p>
      <motion.h1
        className="text-5xl md:text-7xl font-light lowercase leading-tight"
        variants={fadeUp}
      >
        your event,
        <br />
        perfectly scored.
      </motion.h1>
      <motion.p
        className="text-lg md:text-xl text-white/70 font-light max-w-lg"
        variants={fadeUp}
      >
        professional DJ and MC services for weddings, corporate events, and
        private parties — los angeles & beyond.
      </motion.p>
      <motion.a
        href="mailto:nathanielrbowman@gmail.com?subject=DJ%20%2F%20MC%20Booking%20Inquiry"
        className="mt-4 px-8 py-3 border border-white/30 text-white text-lg font-light lowercase
          hover:bg-white hover:text-black transition-colors duration-200
          focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        variants={fadeUp}
      >
        book nathaniel
      </motion.a>
    </motion.div>
  </section>
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
  <section className="px-6 py-20 max-w-5xl mx-auto w-full">
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={stagger}
      className="flex flex-col gap-12"
    >
      <motion.h2
        className="text-5xl font-light lowercase text-center underline"
        variants={fadeUp}
      >
        what i do
      </motion.h2>
      <motion.div
        className="grid grid-cols-1 md:grid-cols-3 gap-8"
        variants={stagger}
      >
        {services.map((s) => (
          <motion.div
            key={s.title}
            className="flex flex-col gap-4 border border-white/10 p-8 text-left
              hover:border-white/30 transition-colors duration-200"
            variants={fadeUp}
          >
            <span className="text-3xl">{s.icon}</span>
            <h3 className="text-2xl font-light lowercase">{s.title}</h3>
            <p className="text-white/70 font-light text-sm leading-relaxed">
              {s.description}
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {s.details.map((d) => (
                <li
                  key={d}
                  className="text-sm font-light text-white/50 flex items-center gap-2"
                >
                  <span className="text-cyan-500">—</span> {d}
                </li>
              ))}
            </ul>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  </section>
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
  <section className="px-6 py-20 w-full bg-white/2">
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={stagger}
      className="flex flex-col gap-12 max-w-4xl mx-auto"
    >
      <motion.h2
        className="text-5xl font-light lowercase text-center underline"
        variants={fadeUp}
      >
        how it works
      </motion.h2>
      <motion.div
        className="flex flex-col md:flex-row gap-8 md:gap-4"
        variants={stagger}
      >
        {steps.map((step, i) => (
          <motion.div
            key={step.number}
            className="flex-1 flex flex-col gap-3 text-center px-4"
            variants={fadeUp}
          >
            <span className="text-5xl font-light text-white/20">
              {step.number}
            </span>
            <h3 className="text-xl font-light lowercase">{step.title}</h3>
            <p className="text-white/60 font-light text-sm leading-relaxed">
              {step.description}
            </p>
            {i < steps.length - 1 && (
              <div className="hidden md:block absolute" />
            )}
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  </section>
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
    className="text-cyan-500 text-lg tracking-wider"
    aria-label="5 out of 5 stars"
  >
    ★★★★★
  </span>
);

const Reviews = () => (
  <section className="px-6 py-20 max-w-5xl mx-auto w-full">
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={stagger}
      className="flex flex-col gap-12"
    >
      <motion.div
        className="flex flex-col items-center gap-2"
        variants={fadeUp}
      >
        <h2 className="text-5xl font-light lowercase text-center underline">
          what clients say
        </h2>
        <p className="text-white/50 font-light text-sm">5.0 · 4 reviews</p>
      </motion.div>
      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 gap-6"
        variants={stagger}
      >
        {reviews.map((r, i) => (
          <motion.div
            key={i}
            className="flex flex-col gap-4 border border-white/10 p-8 text-left"
            variants={fadeUp}
          >
            <Stars />
            <p className="text-white/80 font-light text-sm leading-relaxed italic">
              &ldquo;{r.quote}&rdquo;
            </p>
            <div className="mt-auto pt-4 border-t border-white/10 flex justify-between items-end">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-light">{r.name}</span>
                <span className="text-xs text-white/50 lowercase">
                  {r.eventType}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-xs text-white/40">{r.date}</span>
                <span className="text-xs text-cyan-500/80">{r.platform}</span>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  </section>
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
    <div className="border-b border-white/10">
      <button
        className="w-full flex justify-between items-center py-5 text-left gap-4
          hover:text-white/80 transition-colors duration-150
          focus:outline-none focus-visible:underline focus-visible:decoration-white focus-visible:underline-offset-4"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="text-base font-light lowercase">{q}</span>
        <span
          className={`text-cyan-500 text-xl leading-none transition-transform duration-200 ${
            open ? "rotate-45" : "rotate-0"
          }`}
        >
          +
        </span>
      </button>
      {open && (
        <motion.p
          className="pb-5 text-sm text-white/60 font-light leading-relaxed"
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
  <section className="px-6 py-20 w-full bg-white/2">
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={stagger}
      className="flex flex-col gap-10 max-w-2xl mx-auto"
    >
      <motion.h2
        className="text-5xl font-light lowercase text-center underline"
        variants={fadeUp}
      >
        faq
      </motion.h2>
      <motion.div variants={fadeUp}>
        {faqs.map((item) => (
          <FAQItem key={item.q} {...item} />
        ))}
      </motion.div>
    </motion.div>
  </section>
);

// ─── Booking CTA ─────────────────────────────────────────────────────────────

const BookingCTA = () => (
  <section className="px-6 py-24 flex flex-col items-center text-center gap-8">
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={stagger}
      className="flex flex-col items-center gap-6 max-w-xl"
    >
      <motion.h2 className="text-5xl font-light lowercase" variants={fadeUp}>
        ready to book?
      </motion.h2>
      <motion.p className="text-white/60 font-light" variants={fadeUp}>
        reach out with your event date, venue, and any details you have — i'll
        get back to you within 24 hours.
      </motion.p>
      <motion.div
        className="flex flex-wrap justify-center gap-4"
        variants={fadeUp}
      >
        <a
          href="mailto:nathanielrbowman@gmail.com?subject=DJ%20%2F%20MC%20Booking%20Inquiry"
          className="px-8 py-3 border border-white/30 text-white text-lg font-light lowercase
            hover:bg-white hover:text-black transition-colors duration-200
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          email me
        </a>
        <a
          href="https://instagram.com/actuallyitsnathaniel"
          target="_blank"
          rel="noopener noreferrer"
          className="px-8 py-3 border border-white/10 text-white/70 text-lg font-light lowercase
            hover:border-white/30 hover:text-white transition-colors duration-200
            focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          instagram
        </a>
      </motion.div>
    </motion.div>
  </section>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

const Events = () => {
  return (
    <>
      <SEO
        title="DJ & MC Services — Weddings & Events | actually-its-nathaniel"
        description="Professional DJ and MC services for weddings, corporate events, and private parties in Los Angeles and Southern California. 5-star reviews, fully insured, custom playlists."
        url="https://audio.actuallyitsnathaniel.com/events"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "EntertainmentBusiness",
          name: "actually-its-nathaniel — DJ & MC Services",
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
      <div className="flex flex-col w-full text-center font-light *:text-white">
        <VideoBG />
        <Hero />
        <Services />
        <HowItWorks />
        <Reviews />
        <FAQ />
        <BookingCTA />
        <Footer />
        <NavBar />
      </div>
    </>
  );
};

export default Events;
