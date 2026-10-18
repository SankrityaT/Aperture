// The product name and links live here only; the name is not final.
export const site = {
  name: "Aperture",
  github: "https://github.com/SankrityaT/wicket-build",
  docs: "#",
  start: "#",
  // The MCP server the setup prompt connects agents to.
  slug: "aperture",
  mcpUrl: "https://calm-steel-d31rh.run.mcp-use.com/mcp",
};

// What the "Copy setup prompt" button puts on the clipboard: install, sign in legitimately, discover the tools, one safe read-only call.
export const setupPrompt = (name: string, slug: string, url: string) => `Connect to the ${name} MCP server and run a safe first check.

1. Add it as an MCP server named "${slug}" at ${url}. Use your client's own MCP setup. In Claude Code: claude mcp add --transport http "${slug}" '${url}'
2. If it asks you to sign in, use the sign-in flow it provides. Never ask me to paste a password or key into this chat.
3. List the tools it exposes. For each one, tell me what it does and whether it only reads or can change data.
4. Make one read-only call and show me the result. Change nothing.

Stop and ask me before anything that writes, deletes, or sends.`;

export const copy = {
  // was: "Make any website work for agents."
  h1: "Give agents the web they deserve.",
  heroSub: (name: string) => `Most websites weren\u2019t made for AI agents. ${name} opens a doorway, so they can use those sites without starting from scratch every time.`,
  sub: (name: string) => `${name} turns websites without APIs into tools AI agents can use.`,
  primary: "Get started",
  secondary: "View on GitHub",

  problem: {
    title: "The web wasn’t built for agents.",
    paras: (name: string) => [
      "Millions of applications still depend on forms, buttons, and interfaces designed for people.",
      "Agents can navigate them, but every action takes time, and it’s often hard to tell whether something actually worked.",
      `${name} gives agents a better way in.`,
    ],
  },

  how: {
    title: "Explore once. Execute anytime.",
    steps: (name: string) => [
      { n: "01", name: "Explore", text: "An agent opens a website and learns how it works. No API or custom integration required for supported interfaces." },
      { n: "02", name: "Compile", text: `${name} turns discovered actions into reusable, structured tools that agents can call directly.` },
      { n: "03", name: "Execute", text: "Agents run those tools within their permissions, without repeating the entire exploration." },
      { n: "04", name: "Verify", text: `${name} checks the result, records what changed, and helps agents recover when something goes wrong.` },
    ],
  },

  built: {
    // was: "Built for agents, not around them."
    title: "Agents get the keys. You keep the receipt.",
    items: [
      { name: "Works with existing software.", text: "No need to rebuild the applications you already use." },
      { name: "Reusable by design.", text: "Discover a workflow once. Run it again without starting from scratch." },
      { name: "Autonomy with boundaries.", text: "Agents act within delegated permissions and escalate when necessary." },
      { name: "Know what happened.", text: "Every consequential action gets a result you can inspect, including failures and incomplete recovery." },
    ],
  },

  close: {
    // was: "Give agents access to the rest of the web."
    title: "Open the rest of the web to agents.",
    paras: (name: string) => ["Not every application has an API. Not every business will build an MCP server.", `${name} bridges that gap.`],
    primary: "Start building",
    secondary: "Explore the docs",
  },

  agents: {
    label: "Bring your own agent",
    title: "Works with the agent you already use.",
    sub: (name: string) => `${name} connects through MCP. No new agent or workspace required.`,
    clients: [
      { name: "Claude", logo: "claude" },
      { name: "Claude Code", logo: "claudecode-color" },
      { name: "ChatGPT", logo: "openai" },
      { name: "Codex", logo: "codex" },
      { name: "Cursor", logo: "cursor" },
      { name: "VS Code", logo: "vscode" },
      { name: "GitHub Copilot", logo: "githubcopilot" },
      { name: "Windsurf", logo: "windsurf" },
      { name: "Gemini", logo: "gemini-color" },
      { name: "Gemini CLI", logo: "geminicli-color" },
      { name: "Cline", logo: "cline" },
      { name: "Goose", logo: "goose" },
      { name: "Kilo Code", logo: "kilocode" },
      { name: "Roo Code", logo: "roocode" },
      { name: "Kiro", logo: "kiro" },
      { name: "Amp", logo: "amp" },
      { name: "Antigravity", logo: "antigravity-color" },
      { name: "Trae", logo: "trae" },
      { name: "LM Studio", logo: "lmstudio" },
      { name: "Open WebUI", logo: "openwebui" },
      { name: "Cherry Studio", logo: "cherrystudio" },
    ],
    more: "and any other MCP client.",
    ask: "Already using an agent?",
    copy: "Copy setup prompt",
    copied: "Copied",
    peek: "See what it tells your agent",
  },

  faq: {
    // was: "Frequently asked questions"
    title: "Fair questions.",
    items: (name: string) => [
      { q: `What is ${name}?`, a: `${name} turns websites into reusable tools that AI agents can discover and execute through MCP.` },
      { q: `Who is ${name} for?`, a: "Anyone building AI agents that need to work with websites, especially legacy systems without usable APIs." },
      { q: "Does the website need an API?", a: `No. ${name} explores the interface and learns how to interact with it through a browser.` },
      { q: "How is this different from browser automation?", a: `Instead of reasoning through the same clicks every time, ${name} compiles workflows into reusable tools, with execution checks and recovery where supported.` },
      { q: `Does ${name} work with any website?`, a: `${name} is designed to support a wide range of interfaces. Compatibility depends on the site\u2019s structure, permissions, and available functionality.` },
      { q: "What happens if a website changes?", a: `${name} can detect when a compiled workflow no longer matches the interface. Its self-healing engine is being developed to repair and revalidate those workflows.` },
      { q: "Can agents make changes without human approval?", a: "That\u2019s the goal. Agents operate within delegated permissions, escalating only when necessary." },
      { q: `Can ${name} undo an action?`, a: `When the underlying application supports a recovery path. ${name} distinguishes recoverable changes from irreversible ones.` },
      { q: `Which agents can use ${name}?`, a: "Any compatible MCP client, including Claude, Codex, and Cursor." },
    ],
  },
};
