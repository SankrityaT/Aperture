// The demo systems, on fixed local ports, for judges and for the live demo. They are invented, they hold no real data,
// and they listen on 127.0.0.1 only, so they are reachable by the worker on the same machine and by nothing else.
//   9101  people / staff / secure   classic table, paginated list with confirm(), a login-protected inventory
//   9102  zoo                       SPA grid, DataTables, shadow DOM, iframe, nested tables, infinite scroll
//   9103  aspx                      an ASP.NET WebForms look-alike (postbacks, filter row, pager row)
//   9104  gateportal                a REPLICA of a gate-access admin portal: residents, devices, cascade delete, a delete that can hang
//   9100  control                   POST /reset puts every demo system back to its starting state
import { createServer } from "node:http";
import { startApps } from "../../test/fixtures/apps.js";
import { startZoo } from "../../test/fixtures/zoo.js";
import { startAspx } from "../../test/fixtures/aspx.js";
import { startGatePortal } from "../../test/fixtures/gateportal.js";

const apps = await startApps(9101);
const zoo = await startZoo(9102);
const aspx = await startAspx(9103);
const gate = await startGatePortal(9104);
createServer((req, res) => {
  if (req.method === "POST" && req.url === "/reset") { apps.reset(); zoo.reset(); aspx.reset(); gate.reset(); res.end("reset"); return; }
  res.statusCode = 404; res.end("not found");
}).listen(9100, "127.0.0.1");
console.log(`[demo] ${apps.url}  ${zoo.url}  ${aspx.url}  ${gate.url}  control http://127.0.0.1:9100/reset`);
