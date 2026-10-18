import type { MetadataRoute } from "next";
import { origin } from "@/lib/url";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/agent", "/index.md", "/llms.txt"].map((p) => ({ url: `${origin}${p}` }));
}
