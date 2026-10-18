import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { FormAdapter } from "../src/generator/form-adapter.js";

test("a send control is found by its visible text or by its tooltip (an abbreviated 'Snd Data' button titled 'Send Data Now')", async () => {
  const html = `<!doctype html><title>Accounts</title><form method="post"><button type="submit" name="btnSend" value="Snd Data" title="Send Data Now">Snd Data</button><input type="submit" name="btnSync" value="Sync now"><input type="text" name="q"><input type="submit" value="Find"></form>`;
  const srv = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(html); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const fa = new FormAdapter();
  try {
    const s = await fa.compile(`http://127.0.0.1:${(srv.address() as { port: number }).port}/`);
    assert.ok(s.send_steps?.some((x) => /Snd Data/.test(x) && /Send Data Now/.test(x)), JSON.stringify(s.send_steps));
    assert.ok(s.send_steps?.some((x) => /Sync now/.test(x)));
    assert.ok(!s.send_steps?.some((x) => /Find/.test(x)));
  } finally { await fa.close(); srv.close(); }
});
