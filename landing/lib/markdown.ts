//created by kinjal
import { copy, site, setupPrompt } from "@/lib/site";
import { origin } from "@/lib/url";

// The whole page as markdown, built from the same copy the page renders so the two cannot drift apart.
// Used by /agent (shown), /index.md (raw), the Accept: text/markdown response on /, and llms.txt links to it.
export function pageMarkdown(): string {
  const n = site.name;
  const steps = copy.how.steps(n);
  const faq = copy.faq.items(n);
  const stats = copy.evidence.stats(n);
  const race = stats[0].viz.kind === "bars" ? stats[0].viz : null;
  const prompt = setupPrompt(n, site.slug, site.mcpUrl);

  return [
    `# ${n}`,
    "",
    `> ${copy.h1}`,
    "",
    copy.heroSub(n),
    "",
    `- Website: ${origin}`,
    `- Source: ${site.github}`,
    `- MCP endpoint: ${site.mcpUrl}`,
    `- Docs: ${origin}/docs (markdown: ${origin}/docs.md)`,
    "",
    "## The problem",
    "",
    copy.problem.title,
    "",
    ...copy.problem.paras(n).flatMap((p) => [p, ""]),
    `## ${copy.how.title}`,
    "",
    ...steps.flatMap((s) => [`${Number(s.n)}. **${s.name}.** ${s.text}`]),
    "",
    `## ${copy.evidence.title}`,
    "",
    copy.evidence.sub,
    "",
    ...(race
      ? [
          `| ${race.names[0]} vs ${race.names[1]} | ${race.names[0]} | ${race.names[1]} |`,
          "| --- | --- | --- |",
          ...race.metrics.map((m) => `| ${m.label} | ${m.aText} | ${m.bText} |`),
          "",
        ]
      : []),
    ...stats.flatMap((st) => [`- **${st.big} ${st.unit}. ${st.head}** ${st.text} Run with ${st.ran.map((r) => r.name).join(", ")}.`]),
    "",
    copy.evidence.note,
    "",
    `## ${copy.built.title}`,
    "",
    ...copy.built.items.map((i) => `- **${i.name}** ${i.text}`),
    "",
    `## ${copy.agents.title}`,
    "",
    copy.agents.sub(n),
    "",
    `Compatible MCP clients include ${copy.agents.clients.map((c) => c.name).join(", ")}, ${copy.agents.more}`,
    "",
    "### Connect an agent",
    "",
    "Give this prompt to the agent you already use. It installs the server, signs in through the provided flow, lists the tools, makes one read-only call, and asks before anything that writes.",
    "",
    "```text",
    prompt,
    "```",
    "",
    "## FAQ",
    "",
    ...faq.flatMap((f) => [`### ${f.q}`, "", f.a, ""]),
    `## ${copy.close.title}`,
    "",
    ...copy.close.paras(n).map((p) => p),
    "",
  ].join("\n");
}

// The short index for llms.txt: what this is, and where to read more.
export function llmsTxt(): string {
  const n = site.name;
  return [
    `# ${n}`,
    "",
    `> ${copy.h1} ${copy.heroSub(n)}`,
    "",
    `${n} turns websites without APIs into tools that AI agents can call through MCP. An agent explores a site once, the workflow is compiled into a reusable tool, and later runs skip the exploring.`,
    "",
    "## Read this site",
    "",
    `- [Docs](${origin}/docs.md): connect, how a change works, every MCP tool with parameters and examples, every error with its next move`,
    `- [Full page as markdown](${origin}/index.md): everything on the landing page, in one file`,
    `- [Agent view](${origin}/agent): the same markdown, shown in the browser`,
    `- [Setup prompt](${origin}/setup-prompt.txt): plain text to give an agent that should connect`,
    `- [MCP server details](${origin}/.well-known/mcp.json): endpoint and transport as JSON`,
    "",
    "## Connect",
    "",
    `- MCP endpoint: ${site.mcpUrl}`,
    `- Docs: ${origin}/docs.md`,
    `- Source: ${site.github}`,
    "",
    "## Optional",
    "",
    `- [Sitemap](${origin}/sitemap.xml)`,
    "",
  ].join("\n");
}
