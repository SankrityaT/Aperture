import { copy, site } from "@/lib/site";
import { origin } from "@/lib/url";

// Structured data for crawlers and agents: what the product is, and the FAQ as question/answer pairs.
// Only facts already on the page; no ratings, prices or customer claims.
export function jsonLd() {
  const n = site.name;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: n,
        description: copy.heroSub(n),
        url: origin,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web",
        codeRepository: site.github,
      },
      {
        "@type": "FAQPage",
        mainEntity: copy.faq.items(n).map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
}
