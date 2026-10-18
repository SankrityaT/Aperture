import { setupPrompt, site } from "@/lib/site";

export function GET() {
  return new Response(setupPrompt(site.name, site.slug, site.mcpUrl) + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
