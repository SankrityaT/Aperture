// The gate portal fixture on a fixed port, for recording the self-healing demo. Flip the page while an agent works:
//   curl "http://127.0.0.1:9201/__drift?mode=rename_key"   a safe change: the key column is renamed (Aperture re-learns, proves it, continues)
//   curl "http://127.0.0.1:9201/__drift?mode=no_delete"    a dangerous change: Delete now means Archive (Aperture refuses and tells the owner)
//   curl "http://127.0.0.1:9201/__drift?mode="             back to normal
import { startGatePortal } from "../test/fixtures/gateportal.js";
const g = await startGatePortal(9201);
console.log(`[portal] ${g.url}/Residents.aspx  (synthetic data)`);
