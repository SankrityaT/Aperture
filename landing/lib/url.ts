// The public origin, used for absolute URLs in markdown, sitemap, structured data and share cards.
// Set NEXT_PUBLIC_SITE_URL in production; locally it falls back to the dev server.
export const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3111").replace(/\/$/, "");
