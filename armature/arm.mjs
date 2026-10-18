//created by kinjal
// Thin client for the Armature HTTP API (https://app.armature.tech/api/armature/v1/openapi).
// The API key is read from ~/.config/armature/key (or ARMATURE_API_KEY) and is never printed.
// Armature's API calls an eval case a "workflow"; a workflow id is an eval case id.
//
//   node armature/arm.mjs org                         who the key belongs to
//   node armature/arm.mjs servers                     registered MCP servers
//   node armature/arm.mjs cases                       eval cases
//   node armature/arm.mjs case <id>                   one eval case in full
//   node armature/arm.mjs create <serverId> [n...]    create cases from armature/cases.json (all, or by number)
//   node armature/arm.mjs update [n...]               push cases.json edits to the cases in ids.json
//   node armature/arm.mjs patch <id> '<json>'         update an eval case
//   node armature/arm.mjs run <id> [reason]           start one run (WRITES to the target system)
//   node armature/arm.mjs status <runId>              run status and score
//   node armature/arm.mjs verdict <runId>             the judge's per-criterion evaluation
//   node armature/arm.mjs calls <runId>               tool calls made during the run

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://app.armature.tech/api/armature/v1";
const here = dirname(fileURLToPath(import.meta.url));

function key() {
  if (process.env.ARMATURE_API_KEY) return process.env.ARMATURE_API_KEY.trim();
  return readFileSync(join(homedir(), ".config", "armature", "key"), "utf8").trim();
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${method} ${path}`);
    console.error(typeof data === "string" ? data.slice(0, 1000) : JSON.stringify(data, null, 2).slice(0, 2000));
    process.exit(1);
  }
  return data;
}

const show = (x) => console.log(JSON.stringify(x, null, 2));
const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "org": show(await api("GET", "/org")); break;
  case "servers": show(await api("GET", "/mcp-servers")); break;
  case "cases": show(await api("GET", "/workflows")); break;
  case "case": show(await api("GET", `/workflows/${args[0]}`)); break;

  case "create": {
    const [serverId, ...nums] = args;
    if (!serverId) throw new Error("usage: create <serverId> [n...]");
    const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")).cases;
    for (const c of cases.filter((c) => !nums.length || nums.includes(String(c.n)))) {
      const created = await api("POST", "/workflows", {
        name: c.name,
        description: c.description,
        mcpServerId: serverId,
        testerPrompt: c.prompt,
        criteria: c.criteria.map(([text, required]) => ({ criterionText: text, isRequired: required })),
        metadata: { source: "EVAL_CASES.md", case: c.n },
      });
      const id = created.id ?? created.data?.id ?? created.workflow?.id;
      console.log(`created case ${c.n} "${c.name}" id=${id}`);
    }
    break;
  }

  case "update": {
    // Push name, description, prompt and criteria from cases.json to the existing cases listed in ids.json.
    const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf8")).cases;
    const ids = JSON.parse(readFileSync(join(here, "ids.json"), "utf8")).cases;
    for (const c of cases.filter((c) => !args.length || args.includes(String(c.n)))) {
      await api("PATCH", `/workflows/${ids[c.n]}`, {
        name: c.name,
        description: c.description,
        testerPrompt: c.prompt,
        criteria: c.criteria.map(([text, required]) => ({ criterionText: text, isRequired: required })),
      });
      console.log(`updated case ${c.n} "${c.name}" id=${ids[c.n]}`);
    }
    break;
  }

  case "patch": show(await api("PATCH", `/workflows/${args[0]}`, JSON.parse(args[1]))); break;
  case "run": show(await api("POST", `/workflows/${args[0]}/runs`, { reason: args[1] ?? "manual run from Kinjal's Claude Code" })); break;
  case "status": show(await api("GET", `/runs/${args[0]}`)); break;
  case "verdict": show(await api("GET", `/runs/${args[0]}/evaluation`)); break;
  case "calls": show(await api("GET", `/runs/${args[0]}/tool-calls`)); break;

  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 17).join("\n"));
    process.exit(cmd ? 1 : 0);
}
