import type { MetadataRoute } from "next";
import { origin } from "@/lib/url";

// Everything is open to crawlers and agents. The pages themselves still carry a noindex tag until launch,
// which keeps search engines from listing the site without stopping an agent from reading it.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/" }], sitemap: `${origin}/sitemap.xml` };
}
