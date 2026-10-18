// FormAdapter: turns the forms found by the explorer into an adapter the ticket engine can use.
// Each form is a "kind" with one record, key "current", whose fields are the form's fields.
//  - update  = fill fields (a reversible draft: the old values are saved, undo puts them back)
//  - read    = read the live field values back from the page (this is the read-back)
//  - publish = click the form's submit button. It always needs the owner and cannot be undone.
// Nothing here is specific to a site. It only follows the model the explorer produced.

import { serialize } from "./browser-lock.js";
import type { Browser, Page } from "playwright-core";
import type { Adapter, Kind, Rec } from "../types.js";
import { readCards, readProduct, cardKind, type CardRow } from "./cards.js";
import { explorePage, type FieldModel, type FormModel, type PageModel } from "./explore.js";

export interface CompileSummary {
  url: string;
  title: string;
  warnings: string[];
  /** Controls on this page that send changes elsewhere. Aperture never presses them; publish does, with the owner. */
  send_steps?: string[];
  /** Repeated item cards (search results, product grids) read as records: find(kind) lists them. Read-only. */
  items?: { kind: string; count: number; key: string; fields: string[]; sample: Record<string, unknown>[]; note: string }[];
  forms: {
    id: string;
    title: string;
    submit: string | null;
    fields: { name: string; label: string; type: string; required: boolean; options?: string[]; hint?: string }[];
  }[];
}

export class NotAuthorized extends Error {}
export class NoBrowser extends Error {}
export class NoSecret extends Error {}
export class HumanRequired extends Error {}
/** The browser was busy with (or stuck on) an earlier action, or the worker could not answer in time. Nothing new was started. */
export class WorkerBusy extends Error { override name = "WorkerBusy"; }

/** Credentials live in the server's own environment as WICKET_CREDS_<NAME>="user:password". The agent only ever names one. */
export function readSecret(name: string): { user: string; pass: string } {
  const n = name.toUpperCase();
  if (!/^[A-Z0-9_]{1,40}$/.test(n)) throw new NoSecret("A secret name is letters, digits and underscores.");
  const v = process.env[`WICKET_CREDS_${n}`];
  if (!v || !v.includes(":")) throw new NoSecret(`No stored login named '${name}'. The operator stores one on the server as WICKET_CREDS_${n}.`);
  const i = v.indexOf(":");
  return { user: v.slice(0, i), pass: v.slice(i + 1) };
}

export function allowedHosts(): string[] {
  return (process.env.WICKET_ALLOWED_HOSTS ?? "127.0.0.1,localhost,the-internet.herokuapp.com").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
}

// Two different permissions, never confused:
//  - OBSERVE: visit, read and compile public pages. Open by default (WICKET_PUBLIC_WEB=0 turns it off). Internal and private
//    addresses are never reachable this way: loopback, private ranges, link-local and cloud metadata, *.local / *.internal.
//  - ACT: sign in with a stored login, create, delete, update, publish. Only on systems the operator listed in
//    WICKET_ALLOWED_HOSTS, and then still through preview, the owner's authority, read-back, receipt and undo.
export const publicWeb = (): boolean => process.env.WICKET_PUBLIC_WEB !== "0";

/** An address that must never be reached through public browsing. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
  if (h.includes(":")) return true; // IPv6 literals: not needed for public sites, too many internal forms to list
  if (/^\d+$/.test(h) || /^0x/i.test(h)) return true; // integer or hex IP spellings
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** May Aperture visit and read this address? Listed systems always; any other public site when public browsing is on. */
export function assertAuthorized(url: string): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new NotAuthorized(`'${url}' is not a valid URL.`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new NotAuthorized("Only http and https addresses are supported.");
  const host = u.hostname.toLowerCase();
  if (allowedHosts().includes(host)) return u;
  // Government and military sites, and any host the operator denies (WICKET_DENY_HOSTS, suffixes allowed), are never browsed unless listed.
  const denied = [".gov", ".mil", ...(process.env.WICKET_DENY_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)].some((d) => host === d.replace(/^\./, "") || host.endsWith(d.startsWith(".") ? d : `.${d}`));
  if (denied) throw new NotAuthorized(`'${host}' is a site Aperture does not browse without the operator's explicit listing (government, military, or on the operator's deny list).`);
  if (publicWeb() && !isPrivateHost(host)) return u;
  throw new NotAuthorized(isPrivateHost(host)
    ? `'${host}' is an internal or private address. Aperture never browses those unless the operator lists that exact system.`
    : `'${host}' is not on this server's list of systems, and public browsing is off here. The operator can list it in WICKET_ALLOWED_HOSTS.`);
}

/** May Aperture sign in or change something here? Only on systems the operator listed. Reading a public site never grants this. */
export function assertMayAct(url: string, what: string): void {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* fall through */ }
  if (host && allowedHosts().includes(host)) return;
  throw new NotAuthorized(`Aperture can read '${host || url}' but may not ${what} there: changes and stored logins are only for systems the operator listed (WICKET_ALLOWED_HOSTS). Reading a public site never grants permission to change it.`);
}

/** Open a page and start once its document is in. Big public sites (retail, news) can take far longer than a call's deadline to
 *  fire "load" because of ads and trackers; the records are in the document long before that. Give "load" a few seconds, no more. */
export async function gotoQuick(page: Page, url: string): Promise<void> {
  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: Number(process.env.WICKET_GOTO_TIMEOUT_MS ?? 12_000) }); }
  catch (e) {
    // A site that redirects while loading (search pages do) interrupts the first navigation: wait for where it lands instead.
    if (!/interrupted by another navigation|net::ERR_ABORTED/i.test(String((e as Error).message))) throw e;
    await page.waitForLoadState("domcontentloaded", { timeout: 12_000 });
  }
  await page.waitForLoadState("load", { timeout: 4000 }).catch(() => undefined);
}

/** Without request interception (some sites reject intercepted requests): if the page itself lands on an internal address that
 *  is not a listed system, leave it at once, so nothing read there is ever returned. */
export function watchNavigation(page: Page): void {
  page.on("framenavigated", (f) => {
    if (f !== page.mainFrame()) return;
    let host = ""; try { host = new URL(f.url()).hostname.toLowerCase(); } catch { return; }
    if (host && isPrivateHost(host) && !allowedHosts().includes(host)) void page.goto("about:blank").catch(() => undefined);
  });
}

/** Block every request (redirects and sub-resources included) to an internal address that is not a listed system. */
export async function guardNetwork(page: Page): Promise<void> {
  await page.context().route("**/*", (route) => {
    let host = "";
    try { host = new URL(route.request().url()).hostname.toLowerCase(); } catch { return route.continue(); }
    if (isPrivateHost(host) && !allowedHosts().includes(host)) return route.abort("blockedbyclient");
    return route.continue();
  });
}

const esc = (s: string) => s.replace(/["\\]/g, "\\$&");

export class FormAdapter implements Adapter {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private model: PageModel | null = null;
  /** Cards seen per site, merged across searches on that site so several searches add up to one list. */
  private cards = new Map<string, Map<string, CardRow>>();
  private pageItems: { kind: string; key: string; rows: CardRow[] }[] = [];
  private dirty = new Set<string>();
  private lastResult: Rec | null = null;

  constructor() {
    // Agents call tools in parallel and there is one browser page shared with the table reader: every call that drives it waits its turn.
    serialize(this, ["compile", "signIn", "open", "refresh", "read", "list", "create", "delete", "update", "publish", "reset", "counts", "exportAll"]);
  }

  // ---------- compile ----------

  async compile(url: string): Promise<CompileSummary> {
    assertAuthorized(url);
    const page = await this.ensurePage();
    await gotoQuick(page, url);
    return this.refresh();
  }

  /**
   * Sign in with a stored login. The password is typed by this code and never returned, logged, or shown to a model.
   * A login page with a CAPTCHA is a human step, and we stop there.
   */
  async signIn(url: string, secretName: string): Promise<{ signedIn: boolean; detail: string }> {
    assertAuthorized(url);
    assertMayAct(url, "use a stored login");
    const creds = readSecret(secretName);
    const page = await this.ensurePage();
    await gotoQuick(page, url);
    // Client-rendered apps draw their login form after load. Let the page go quiet, then give a password field a moment to appear before deciding there is none.
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForSelector('input[type="password"]', { timeout: 4000 }).catch(() => undefined);
    const model = await explorePage(page);
    if (model.warnings.length) throw new HumanRequired(model.warnings[0]!);
    const form = model.forms.find((f) => f.fields.some((x) => x.type === "password"));
    if (!form) return { signedIn: true, detail: "No login form on that page, so it is public or already signed in." };
    const pw = form.fields.find((x) => x.type === "password")!;
    const user = form.fields.find((x) => x.type === "text" || x.type === "email");
    if (!user || !form.submit) throw new Error("The login form was not recognised.");
    const scope = page.locator(form.selector);
    await scope.locator(`[name="${esc(user.ref)}"]`).first().fill(creds.user);
    await scope.locator(`[name="${esc(pw.ref)}"]`).first().fill(creds.pass);
    await Promise.all([
      page.waitForLoadState("load").catch(() => undefined),
      scope.locator(form.submit.selector).first().click(),
    ]);
    // A client-rendered app may not navigate at all. Wait for the password field to go away (or the page to change) before judging.
    await page.waitForFunction(() => !document.querySelector('input[type="password"]'), undefined, { timeout: 8000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    const after = await explorePage(page);
    const still = after.forms.some((f) => f.fields.some((x) => x.type === "password"));
    return still ? { signedIn: false, detail: "The login form is still showing. Check the stored login." } : { signedIn: true, detail: "Signed in." };
  }

  /** Move to another page in the same session, for example after signing in. */
  async open(url: string): Promise<void> {
    assertAuthorized(url);
    const page = await this.ensurePage();
    await gotoQuick(page, url);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  }

  async refresh(): Promise<CompileSummary> {
    const page = this.page;
    if (!page) throw new NoBrowser("Nothing compiled yet. Call compile_site first.");
    try { this.model = await explorePage(page); }
    catch (e) {
      // The page moved while being read (a redirect, a variant picked by the site): let it settle and read it once more.
      if (!/context was destroyed|navigation/i.test(String((e as Error).message))) throw e;
      await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
      this.model = await explorePage(page);
    }
    this.dirty.clear();
    this.pageItems = [];
    // A product page first: when the page is one product, read that and ignore its "related products" carousels.
    const prod = await readProduct(page).catch(() => null);
    const groups = prod ? [] : await readCards(page).catch(() => []);
    groups.forEach((g, i) => {
      const kind = cardKind(page.url(), i);
      const m = this.cards.get(kind) ?? new Map<string, CardRow>();
      for (const r of g.rows) m.set(r.key, r);
      while (m.size > 500) m.delete(m.keys().next().value as string);
      this.cards.set(kind, m);
      this.pageItems.push({ kind, key: g.attr.replace(/^data-/, ""), rows: g.rows });
    });
    // A single product page: its record joins the same site list, marked as read from the product page itself.
    {
      if (prod) {
        const kind = cardKind(page.url(), 0);
        const m = this.cards.get(kind) ?? new Map<string, CardRow>();
        m.set(prod.key, { ...(m.get(prod.key) ?? {}), ...prod });
        this.cards.set(kind, m);
        this.pageItems.push({ kind, key: "product page", rows: [prod] });
      }
    }
    return this.summary();
  }

  summary(): CompileSummary {
    const m = this.model;
    if (!m) throw new NoBrowser("Nothing compiled yet. Call compile_site first.");
    return {
      url: m.url, title: m.title, warnings: this.pageItems.length ? m.warnings.map((w) => (/captcha|bot challenge/i.test(w) ? "A CAPTCHA script is on this page, but it did not block it: the page content loaded and was read." : w)) : m.warnings, ...(m.sendControls?.length ? { send_steps: m.sendControls } : {}),
      ...(this.pageItems.length ? { items: this.pageItems.map((g) => ({ kind: g.kind, count: g.rows.length, key: g.key, fields: ["title", "price", "rating", "ratings", "url", "sku", "note"], sample: g.rows.slice(0, 3), note: `find('${g.kind}') lists every card read on this site so far (${this.cards.get(g.kind)?.size ?? g.rows.length}); search again and they add up. Read-only: what the cards show, not the product page.` })) } : {}),
      // Retail pages carry dozens of hidden widget forms; with item cards present only the first few are worth an agent's tokens.
      forms: (this.pageItems.length ? m.forms.slice(0, 3) : m.forms).map((f) => ({
        id: f.id, title: f.title, submit: f.submit?.label ?? null,
        fields: f.fields.map((x) => ({
          name: x.name, label: x.label, type: x.type, required: x.required,
          ...(x.options ? { options: x.options.map((o) => (o.label && o.label !== o.value ? `${o.value} (${o.label})` : o.value)) } : {}),
          ...(hint(x) ? { hint: hint(x) } : {}),
        })),
      })),
    };
  }

  formIds(): string[] {
    return this.model?.forms.map((f) => f.id) ?? [];
  }

  /** The live browser page, shared with the table adapter so both work in one logged-in session. */
  currentPage(): Page | null {
    return this.page;
  }

  /** A page stuck on an action that never finished: open a fresh page in the same signed-in session and close the stuck one.
   *  Closing it makes the stuck action fail, so the browser lock is released. Compiled pages are kept; the next call opens its page again. */
  async replacePage(): Promise<void> {
    const old = this.page;
    if (!old) return;
    try { this.page = await old.context().newPage(); }
    catch { await this.close(); return; } // no way to keep the session: drop the browser; the next call starts a new one

    if (process.env.WICKET_ACTION_TIMEOUT_MS) this.page.setDefaultTimeout(Number(process.env.WICKET_ACTION_TIMEOUT_MS));
    await old.close().catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null; this.page = null;
  }

  private async ensurePage(): Promise<Page> {
    // A window someone closed, or a browser that went away: start fresh instead of failing every call after it.
    if (this.page && (this.page.isClosed() || (this.browser && !this.browser.isConnected()))) { await this.close(); }
    if (this.page) return this.page;
    let chromium;
    try { ({ chromium } = await import("playwright-core")); } catch { throw new NoBrowser("No browser library is available on this server."); }
    if (process.env.WICKET_CDP_URL) {
      // Attach to a browser a person already signed in to (MFA and all). Wicket never sees the password; it reuses the session.
      try {
        this.browser = await chromium.connectOverCDP(process.env.WICKET_CDP_URL);
        const ctx = this.browser.contexts()[0] ?? (await this.browser.newContext());
        this.page = ctx.pages().find((p) => !p.url().startsWith("chrome://")) ?? (await ctx.newPage());
        return this.page;
      } catch (e) {
        throw new NoBrowser(`Could not attach to the signed-in browser (${String((e as Error).message).split("\n")[0]}).`);
      }
    }
    try {
      // WICKET_HEADED=1 opens a visible window and WICKET_SLOWMO=<ms> slows every action, so a person can watch what it does.
      this.browser = await chromium.launch({ headless: process.env.WICKET_HEADED !== "1", slowMo: Number(process.env.WICKET_SLOWMO ?? 0), ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    } catch (e) {
      throw new NoBrowser(`No browser could be started here (${String((e as Error).message).split("\n")[0]}). Run the worker on a machine with a browser.`);
    }
    // An explicit context (not browser.newPage) so a stuck page can be replaced inside the same signed-in session.
    const ctx = await this.browser.newContext({ viewport: process.env.WICKET_HEADED === "1" ? { width: 1280, height: 800 } : undefined });
    this.page = await ctx.newPage();
    if (process.env.WICKET_NETWORK_GUARD !== "0") await guardNetwork(this.page); else watchNavigation(this.page);
    if (process.env.WICKET_ACTION_TIMEOUT_MS) this.page.setDefaultTimeout(Number(process.env.WICKET_ACTION_TIMEOUT_MS));
    return this.page;
  }

  private form(kind: Kind): FormModel | undefined {
    return this.model?.forms.find((f) => f.id === kind);
  }

  // ---------- Adapter ----------

  /** Card lists are already in memory: reading them never waits for the browser. */
  cardRows(kind: Kind, key?: string): Rec[] | Rec | null | undefined {
    const cards = this.cards.get(kind);
    if (!cards) return undefined;
    return key === undefined ? ([...cards.values()] as Rec[]) : ((cards.get(key) as Rec | undefined) ?? null);
  }

  kinds(): Kind[] {
    return [...this.formIds(), ...this.cards.keys(), ...(this.lastResult ? ["result"] : [])];
  }

  async read(kind: Kind, key: string): Promise<Rec | null> {
    if (kind === "result") return key === "latest" ? this.lastResult : null;
    const cards = this.cards.get(kind);
    if (cards) return (cards.get(key) as Rec | undefined) ?? null;
    const form = this.form(kind);
    if (!form || key !== "current" || !this.page) return null;
    const values = await this.page.locator(form.selector).evaluate((formEl: HTMLFormElement, fields: FieldModel[]) => {
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        const node = f.refBy === "name" ? formEl.elements.namedItem(f.ref) : formEl.querySelector(`#${CSS.escape(f.ref)}`);
        if (!node) { out[f.name] = null; continue; }
        if (f.type === "radio") out[f.name] = (node as RadioNodeList).value ?? "";
        else if (f.type === "checkbox") out[f.name] = (node as HTMLInputElement).checked;
        else if (f.type === "select") out[f.name] = (node as HTMLSelectElement).value;
        else out[f.name] = (node as HTMLInputElement).value;
      }
      return out;
    }, form.fields);
    return { key: "current", ...values };
  }

  async list(kind: Kind): Promise<Rec[]> {
    const cards = this.cards.get(kind);
    if (cards) return [...cards.values()] as Rec[];
    const r = await this.read(kind, kind === "result" ? "latest" : "current");
    return r ? [r] : [];
  }

  async create(): Promise<void> {
    throw new Error("Forms cannot be created. Use update to fill fields, then publish to submit.");
  }

  async delete(): Promise<void> {
    throw new Error("Forms cannot be deleted. Use update to clear fields.");
  }

  /** The page stores strings, option values and booleans. Say each value that way, so a read-back compares like with like. */
  async normalize(kind: Kind, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const form = this.form(kind);
    const out: Record<string, unknown> = {};
    for (const [name, raw] of Object.entries(patch)) {
      const f = form?.fields.find((x) => x.name === name);
      if (!f) { out[name] = raw; continue; }
      if (f.type === "checkbox") out[name] = raw === true;
      else if (f.type === "select" || f.type === "radio") out[name] = matchOption(f, String(raw))?.value ?? String(raw);
      else out[name] = raw === null || raw === undefined ? "" : String(raw);
    }
    return out;
  }

  async validate(kind: Kind, _key: string, patch: Record<string, unknown>): Promise<string[]> {
    const form = this.form(kind);
    if (!form) return [`unknown form '${kind}'`];
    const problems: string[] = [];
    for (const [name, raw] of Object.entries(patch)) {
      const f = form.fields.find((x) => x.name === name);
      if (!f) continue; // the engine already reports unknown fields with the valid list
      if (f.disabled || f.readonly) { problems.push(`${name} is read-only`); continue; }
      const v = raw === null || raw === undefined ? "" : raw;
      const s = String(v);
      if (f.required && f.type !== "checkbox" && s.trim() === "") { problems.push(`${name} is required and cannot be empty`); continue; }
      if (f.type === "checkbox") { if (typeof v !== "boolean") problems.push(`${name} must be true or false`); continue; }
      if (s === "") continue;
      if (f.type === "select" || f.type === "radio") {
        if (!matchOption(f, s)) problems.push(`${name} must be one of: ${(f.options ?? []).filter((o) => o.value !== "").map((o) => (o.label && o.label !== o.value ? `${o.value} (${o.label})` : o.value)).join(", ")}`);
        continue;
      }
      if (f.type === "number") {
        const n = Number(s);
        if (!Number.isFinite(n)) { problems.push(`${name} must be a number`); continue; }
        if (f.min !== undefined && n < Number(f.min)) problems.push(`${name} must be at least ${f.min}`);
        if (f.max !== undefined && n > Number(f.max)) problems.push(`${name} must be at most ${f.max}`);
      }
      if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) problems.push(`${name} must be an email address`);
      if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) problems.push(`${name} must be a date like 2026-10-18`);
      if (f.maxlength !== undefined && s.length > f.maxlength) problems.push(`${name} is longer than ${f.maxlength} characters`);
      if (f.pattern) { try { if (!new RegExp(`^(?:${f.pattern})$`).test(s)) problems.push(`${name} does not match the required format (${f.pattern})`); } catch { /* ignore a bad pattern */ } }
    }
    return problems;
  }

  async update(kind: Kind, _key: string, patch: Record<string, unknown>): Promise<void> {
    const form = this.form(kind);
    const page = this.page;
    if (!form || !page) throw new Error(`unknown form '${kind}'`);
    assertMayAct(page.url(), "fill in or submit a form");
    const scope = page.locator(form.selector);
    for (const [name, raw] of Object.entries(patch)) {
      const f = form.fields.find((x) => x.name === name);
      if (!f) throw new Error(`unknown field '${name}'`);
      const loc = f.refBy === "name" ? scope.locator(`[name="${esc(f.ref)}"]`) : page.locator(`#${esc(f.ref)}`);
      if (f.type === "checkbox") await loc.first().setChecked(raw === true);
      else if (f.type === "radio") {
        if (raw === "" || raw === null || raw === undefined) {
          // Nothing selected: a radio group cannot be unchecked by choosing an option, so clear it.
          await scope.locator(`input[type=radio][name="${esc(f.ref)}"]`).evaluateAll((els) => els.forEach((e) => { (e as HTMLInputElement).checked = false; }));
          continue;
        }
        const opt = matchOption(f, String(raw));
        if (!opt) throw new Error(`${name}: no such option`);
        await scope.locator(`input[type=radio][name="${esc(f.ref)}"][value="${esc(opt.value)}"]`).check();
      } else if (f.type === "select") {
        const opt = matchOption(f, String(raw));
        if (!opt) throw new Error(`${name}: no such option`);
        await loc.first().selectOption(opt.value);
      } else await loc.first().fill(raw === null || raw === undefined ? "" : String(raw));
    }
    this.dirty.add(kind);
  }

  async counts(_forKind?: Kind): Promise<Record<Kind, number>> {
    return {};
  }

  async exportAll(_forKind?: Kind): Promise<Record<Kind, Rec[]>> {
    const out: Record<Kind, Rec[]> = {};
    for (const id of this.formIds()) out[id] = await this.list(id);
    return out;
  }

  async pendingPublish(): Promise<string[]> {
    return [...this.dirty].map((id) => `submit ${id} (${this.form(id)?.submit?.label ?? "Submit"})`);
  }

  /** Submit every filled form. Always needs the owner, decided by the engine. */
  async publish(): Promise<{ published: number; notified: number }> {
    const page = this.page;
    if (!page) throw new NoBrowser("Nothing compiled yet.");
    assertMayAct(page.url(), "publish");
    let published = 0;
    for (const id of [...this.dirty]) {
      const form = this.form(id);
      if (!form?.submit) throw new Error(`form '${id}' has no submit button`);
      await Promise.all([
        page.waitForLoadState("load").catch(() => undefined),
        page.locator(form.selector).locator(form.submit.selector).first().click(),
      ]);
      published++;
    }
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 400));
    this.lastResult = { key: "latest", url: page.url(), title: await page.title(), text };
    this.model = await explorePage(page);
    this.dirty.clear();
    return { published, notified: 0 };
  }

  /** Forget what was compiled. The browser stays warm for the next compile. */
  async reset(): Promise<void> {
    this.dirty.clear();
    this.lastResult = null;
    this.model = null;
    this.cards.clear(); this.pageItems = [];
  }
}

function matchOption(f: FieldModel, v: string): { value: string; label: string } | undefined {
  const t = v.trim().toLowerCase();
  return (f.options ?? []).find((o) => o.value.toLowerCase() === t) ?? (f.options ?? []).find((o) => o.label.toLowerCase() === t);
}

function hint(f: FieldModel): string | undefined {
  const parts: string[] = [];
  if (f.type === "date") parts.push("YYYY-MM-DD");
  if (f.min !== undefined || f.max !== undefined) parts.push(`${f.min ?? ""}..${f.max ?? ""}`);
  if (f.maxlength !== undefined) parts.push(`max ${f.maxlength} chars`);
  if (f.pattern) parts.push(`format ${f.pattern}`);
  if (f.readonly || f.disabled) parts.push("read-only");
  return parts.length ? parts.join(", ") : undefined;
}
