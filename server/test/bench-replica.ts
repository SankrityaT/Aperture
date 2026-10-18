// One gate-portal replica on a given port, for one benchmark run. Prints its address and stays up until killed.
import { startGatePortal } from "./fixtures/gateportal.js";
const port = Number(process.argv[2]);
const g = await startGatePortal(port);
console.log(`replica ${g.url}`);
setInterval(() => undefined, 1 << 30);
