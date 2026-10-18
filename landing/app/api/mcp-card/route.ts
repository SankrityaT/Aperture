import { copy, site } from "@/lib/site";
import { origin } from "@/lib/url";

// Served at /.well-known/mcp.json (see next.config.ts). A plain description of the MCP server for agents and tools.
// There is no final standard for this file yet, so it sticks to facts stated elsewhere on the site.
export function GET() {
  return Response.json(
    {
      name: site.slug,
      title: site.name,
      description: copy.heroSub(site.name),
      endpoint: site.mcpUrl,
      transport: "http",
      website: origin,
      source: site.github,
      setup_prompt: `${origin}/setup-prompt.txt`,
      docs_for_agents: `${origin}/llms.txt`,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
