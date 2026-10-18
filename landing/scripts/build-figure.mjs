// Wraps the Hairline kernel and each figure into a browser script that
// registers window.__hairline[name] = { HL, figure } without touching other globals.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const kernel = readFileSync(join(homedir(), ".claude/skills/hairline-create/kernel.js"), "utf8");
const dir = new URL("../figure/", import.meta.url);

for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const name = file.replace(/\.js$/, "");
  const figure = readFileSync(new URL(file, dir), "utf8");
  const out = `(function(){
${kernel}
var __fig;
function hairline(f){ __fig = f; }
${figure}
window.__hairline = window.__hairline || {};
window.__hairline[${JSON.stringify(name)}] = { HL: HL, figure: __fig };
})();
`;
  writeFileSync(new URL(`../public/hairline/${name}.js`, import.meta.url), out);
  console.log("wrote public/hairline/" + name + ".js");
}
