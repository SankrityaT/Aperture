// A tiny local site with four pages built in four different styles. The generator has no code for any of them.
// It exists so we can test generality without touching any system we do not own.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface TestSite {
  url: string;
  submissions: { path: string; body: Record<string, string> }[];
  close(): Promise<void>;
}

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

const SIGNUP = page("Sign up", `
<h1>Student sign-up</h1>
<form id="signup" method="post" action="/signup">
  <input type="hidden" name="csrf" value="abc123">
  <label for="studentid">Student ID</label> <input id="studentid" name="studentid" value="STU-1" readonly><br>
  <label for="username">Username *</label> <input id="username" name="username" required><br>
  <label for="email">Email</label> <input id="email" name="email" type="email"><br>
  <label for="age">Age</label> <input id="age" name="age" type="number" min="16" max="19"><br>
  <label for="grade">Grade</label>
  <select id="grade" name="grade"><option value="">Pick one</option><option value="9">Year 9</option><option value="10">Year 10</option><option value="11">Year 11</option></select><br>
  <fieldset><legend>House</legend>
    <label><input type="radio" name="house" value="red"> Red</label>
    <label><input type="radio" name="house" value="blue"> Blue</label>
    <label><input type="radio" name="house" value="green"> Green</label>
  </fieldset>
  <label for="dob">Date of birth</label> <input id="dob" name="dob" type="date"><br>
  <label for="notes">Notes</label> <textarea id="notes" name="notes" maxlength="40"></textarea><br>
  <label><input type="checkbox" name="consent" required> I agree to the rules</label><br>
  <button type="submit">Create account</button>
</form>`);

const ADDRESS = page("Address book", `
<h2>Delivery address</h2>
<form name="address" method="post" action="/address">
<table>
  <tr><td>Street</td><td><input type="text" name="street"></td></tr>
  <tr><td>City</td><td><input type="text" name="city"></td></tr>
  <tr><td>Postcode *</td><td><input type="text" name="zip" pattern="[A-Z]{2}[0-9]{2}" required></td></tr>
  <tr><td>Country</td><td><select name="country"><option value="" disabled selected>Choose</option><option value="uk">United Kingdom</option><option value="us">United States</option></select></td></tr>
  <tr><td>Delivery</td><td><input type="radio" name="delivery" value="std"> Standard <input type="radio" name="delivery" value="exp"> Express</td></tr>
  <tr><td></td><td><input type="submit" value="Save address"></td></tr>
</table>
</form>`);

const SURVEY = page("Survey", `
<section><h3>Newsletter</h3>
<form aria-label="Newsletter" method="post" action="/newsletter">
  <input aria-label="Your email" name="email" type="email">
  <label><input type="checkbox" name="weekly"> Weekly digest</label>
  <button>Join</button>
</form></section>
<section><h3>Feedback</h3>
<form aria-label="Feedback" method="post" action="/feedback">
  <input aria-label="Rating (1 to 5)" name="rating" type="number" min="1" max="5">
  <textarea aria-label="Comments" name="comments"></textarea>
  <button>Send</button>
</form></section>`);

const CAPTCHA = page("Protected", `<form id="login" method="post" action="/login"><label for="u">User</label><input id="u" name="u"><div class="g-recaptcha" data-sitekey="x"></div><button>Sign in</button></form>`);

export async function startSite(): Promise<TestSite> {
  const submissions: TestSite["submissions"] = [];
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!;
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = Object.fromEntries(new URLSearchParams(raw));
        submissions.push({ path, body });
        res.setHeader("content-type", "text/html");
        res.end(page("Thanks", `<h1>Thanks, received ${Object.keys(body).length} fields</h1><p id="echo">${JSON.stringify(body)}</p>`));
      });
      return;
    }
    const html = path === "/signup" ? SIGNUP : path === "/address" ? ADDRESS : path === "/survey" ? SURVEY : path === "/captcha" ? CAPTCHA : null;
    res.statusCode = html ? 200 : 404;
    res.setHeader("content-type", "text/html");
    res.end(html ?? page("Not found", "<h1>Not found</h1>"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, submissions, close: () => new Promise((r) => server.close(() => r())) };
}
