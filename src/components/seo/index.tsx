import { useHead } from "@unhead/react";

interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  type?: "website" | "music.album" | "music.song" | "profile";
  jsonLd?: object;
}

const SEO = ({
  title = "actually-its-nathaniel - Music Producer & Audio Engineer",
  description = "Professional music producer and audio engineer specializing in modern production, mixing, and sound design. Explore my portfolio of projects and collaborations.",
  image = "https://actuallyitsnathaniel.com/og-image.png",
  url = "https://actuallyitsnathaniel.com",
  type = "website",
  jsonLd,
}: SEOProps) => {
  const fullTitle = title.includes("actually-its-nathaniel")
    ? title
    : `${title} | actually-its-nathaniel`;

  useHead({
    title: fullTitle,
    meta: [
      { name: "title", content: fullTitle },
      { name: "description", content: description },
      { name: "robots", content: "index, follow" },
      { name: "language", content: "English" },
      { name: "author", content: "Nathaniel Bowman" },
      { property: "og:type", content: type },
      { property: "og:url", content: url },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: description },
      { property: "og:image", content: image },
      { property: "og:site_name", content: "actually-its-nathaniel" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:url", content: url },
      { name: "twitter:title", content: fullTitle },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image },
    ],
    link: [{ rel: "canonical", href: url }],
    script: jsonLd ? [{ type: "application/ld+json", children: JSON.stringify(jsonLd) }] : [],
  });

  return null;
};

export default SEO;
