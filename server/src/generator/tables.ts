// Generic record lists. Any page with a headed table becomes a "kind" whose rows are records.
// Nothing here knows any particular system. It finds, by structure alone:
//   - the columns (header text)
//   - a stable key (a unique id-like column, or a unique id inside the row's own links)
//   - the row actions, classified by what their label means (delete, edit, view)
//   - the "add" button, and pagination
// Delete is "click the row's delete action, accept a dialog, click the confirm button on the next page".
// Create is "click add, fill the form it opens, submit". Both are read back from the list afterwards.

import type { Page } from "playwright-core";
import type { Adapter, Kind, Rec } from "../types.js";
import { explorePage, type FormModel } from "./explore.js";
import { assertAuthorized } from "./form-adapter.js";

export type ActionType = "delete" | "edit" | "view" | "other";

export interface RawAction { label: string; href: string; onclick: string; cls: string; tag: string }
export interface RawRow { cells: string[]; actions: RawAction[] }
export interface RawTable {
  index: number; title: string; headers: string[]; rows: RawRow[];
  next: string | null; add: { label: string; href: string; index: number } | null;
}

export interface TableModel {
  id: string; url: string; tableIndex: number; title: string;
  columns: string[]; keyColumn: string | null; keyParam: string | null; keySource: "column" | "link" | "none";
  actions: { label: string; type: ActionType }[]; add: string | null; paged: boolean; rows: number;
}

// ---- the in-page reader. Plain JavaScript in a string on purpose (see explore.ts). ----

const TABLES_SCRIPT = `(() => {
  var clean = function (s) { return (s == null ? "" : String(s)).replace(/\\s+/g, " ").trim(); };
  var abs = function (h) { try { return new URL(h, location.href).href; } catch (e) { return h || ""; } };
  var sel = 'a[href], button, input[type=submit], input[type=button], [role=button], [onclick]';
  var labelOf = function (a) {
    var l = clean(a.innerText || a.value || "");
    if (l) return l;
    l = clean(a.getAttribute("title") || a.getAttribute("aria-label") || "");
    if (l) return l;
    var img = a.querySelector("img[alt]");
    if (img) return clean(img.getAttribute("alt"));
    return "";
  };
  var out = [];
  Array.prototype.forEach.call(document.querySelectorAll("table"), function (t, ti) {
    var headRow = t.querySelector("thead tr");
    if (!headRow) { var r0 = t.querySelector("tr"); if (r0 && r0.querySelector("th")) headRow = r0; }
    if (!headRow) return;
    var headers = Array.prototype.map.call(headRow.children, function (c) { return clean(c.innerText); });
    var trs = Array.prototype.filter.call(t.querySelectorAll("tr"), function (r) { return r !== headRow && r.querySelectorAll("td").length > 0; });
    var rows = trs.map(function (r) {
      var cells = Array.prototype.map.call(r.children, function (c) { return clean(c.innerText); });
      var actions = Array.prototype.map.call(r.querySelectorAll(sel), function (a) {
        return { label: labelOf(a), href: a.getAttribute("href") ? abs(a.getAttribute("href")) : "", onclick: clean(a.getAttribute("onclick") || "").slice(0, 160), cls: clean(a.className || ""), tag: a.tagName.toLowerCase() };
      });
      return { cells: cells, actions: actions };
    });
    var title = "";
    var prev = t.previousElementSibling;
    while (prev && !title) { if (/^H[1-6]$/.test(prev.tagName)) title = clean(prev.innerText); prev = prev.previousElementSibling; }
    if (!title) { var cap = t.querySelector("caption"); title = cap ? clean(cap.innerText) : clean(document.title); }
    var next = null;
    var links = Array.prototype.slice.call(document.querySelectorAll("a[href]"));
    for (var i = 0; i < links.length; i++) {
      var l = links[i], txt = clean(l.innerText), aria = (l.getAttribute("aria-label") || "").toLowerCase();
      if (l.getAttribute("rel") === "next" || /^(next|older)\\b/i.test(txt) || /^[>›»]+$/.test(txt) || aria.indexOf("next") >= 0) { next = abs(l.getAttribute("href")); break; }
    }
    var add = null;
    var cands = Array.prototype.slice.call(document.querySelectorAll('a[href], button, input[type=submit], input[type=button], [role=button]'));
    for (var j = 0; j < cands.length; j++) {
      var c = cands[j];
      if (t.contains(c)) continue;
      var cl = labelOf(c);
      if (/^(\\+|add|new|create|register|invite)\\b/i.test(cl) || /\\b(add|new|create) /i.test(cl)) { add = { label: cl, href: c.getAttribute("href") ? abs(c.getAttribute("href")) : "", index: j }; break; }
    }
    out.push({ index: ti, title: title, headers: headers, rows: rows, next: next, add: add });
  });
  return out;
})()`;

// ---- what an action label means ----

export function classifyAction(a: Pick<RawAction, "label" | "href" | "onclick" | "cls">): ActionType {
  const hay = `${a.label} ${a.href} ${a.onclick} ${a.cls}`.toLowerCase();
  if (/(^|[^a-z])(delete|remove|trash|destroy|discard|erase|bin)([^a-z]|$)|fa-trash|fa-times|icon-trash/.test(hay)) return "delete";
  if (/(^|[^a-z])(edit|modify|update|change|manage|configure)([^a-z]|$)|fa-pen|fa-edit/.test(hay)) return "edit";
  if (/(^|[^a-z])(view|details?|open|show|profile|select)([^a-z]|$)/.test(hay)) return "view";
  return "other";
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);

/** Params in the row's own links that differ per row. The unique one is the system's id. */
function linkParams(rows: RawRow[]): Map<string, string[]> {
  const byParam = new Map<string, string[]>();
  rows.forEach((r, i) => {
    const seen = new Set<string>();
    for (const a of r.actions) {
      if (!a.href) continue;
      try {
        const u = new URL(a.href);
        for (const [k, v] of u.searchParams) {
          if (seen.has(k) || v === "") continue;
          seen.add(k);
          const arr = byParam.get(k) ?? [];
          arr[i] = v;
          byParam.set(k, arr);
        }
      } catch { /* ignore a bad link */ }
    }
  });
  return byParam;
}

function dataColumns(t: RawTable): number[] {
  const acts = new Set(t.rows.flatMap((r) => r.actions.map((a) => a.label.toLowerCase())).filter(Boolean));
  const idx: number[] = [];
  t.headers.forEach((h, i) => {
    if (!h) return;
    const vals = t.rows.map((r) => (r.cells[i] ?? "").toLowerCase());
    if (vals.length && vals.every((v) => v === "" || acts.has(v))) return; // an actions column
    idx.push(i);
  });
  return idx;
}

export interface KeyInfo { column: string | null; columnIndex: number; param: string | null; source: "column" | "link" | "none" }

export function findKey(t: RawTable): KeyInfo {
  const cols = dataColumns(t);
  const n = t.rows.length;
  const unique = (vals: (string | undefined)[]) => vals.length === n && vals.every((v) => !!v) && new Set(vals).size === n;
  // 1. a unique id-like column
  for (const i of cols) {
    if (/\b(id|code|key|number|no\.?|ref|username|email|login)\b/i.test(t.headers[i]!) && unique(t.rows.map((r) => r.cells[i]))) return { column: t.headers[i]!, columnIndex: i, param: null, source: "column" };
  }
  // 2. a unique value inside the row's own links
  for (const [param, vals] of linkParams(t.rows)) {
    if (unique(vals)) return { column: null, columnIndex: -1, param, source: "link" };
  }
  // 3. any unique column
  for (const i of cols) if (unique(t.rows.map((r) => r.cells[i]))) return { column: t.headers[i]!, columnIndex: i, param: null, source: "column" };
  return { column: null, columnIndex: -1, param: null, source: "none" };
}

export function rowKey(t: RawTable, k: KeyInfo, ri: number): string | null {
  const r = t.rows[ri]!;
  if (k.source === "column") return r.cells[k.columnIndex] || null;
  if (k.source === "link") {
    for (const a of r.actions) {
      try { const v = new URL(a.href).searchParams.get(k.param!); if (v) return v; } catch { /* ignore */ }
    }
  }
  return null;
}

function toRecord(t: RawTable, k: KeyInfo, ri: number, cols: number[]): Rec | null {
  const key = rowKey(t, k, ri);
  if (!key) return null;
  const rec: Rec = { key };
  for (const i of cols) rec[t.headers[i]!] = t.rows[ri]!.cells[i] ?? "";
  return rec;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export class TableAdapter implements Adapter {
  private models = new Map<string, TableModel>();
  /** When undo re-creates a record, the system may give it a new id. Remember the old one points to the new one. */
  private aliases = new Map<string, string>();
  /** A browser dialog is accepted only while we are expecting one (a delete confirmation). Any other is dismissed. */
  private expectDialog = false;
  private hooked = new WeakSet<Page>();

  constructor(private readonly getPage: () => Page | null) {}

  private hookDialogs(page: Page): void {
    if (this.hooked.has(page)) return;
    this.hooked.add(page);
    page.on("dialog", (d) => { (this.expectDialog ? d.accept() : d.dismiss()).catch(() => undefined); });
  }

  // ---------- compile ----------

  async attach(): Promise<TableModel[]> {
    const page = this.need();
    this.models.clear();
    const raw = await this.rawTables(page);
    const used = new Set<string>();
    for (const t of raw) {
      if (t.headers.filter(Boolean).length < 2) continue;
      const k = findKey(t);
      const cols = dataColumns(t);
      let id = slug(t.title) || `table${t.index + 1}`;
      while (used.has(id)) id += "_x";
      used.add(id);
      const types = new Map<string, ActionType>();
      for (const r of t.rows) for (const a of r.actions) { const label = a.label || a.cls || a.tag; if (!types.has(label)) types.set(label, classifyAction(a)); }
      this.models.set(id, { id, url: page.url(), tableIndex: t.index, title: t.title, columns: cols.map((i) => t.headers[i]!), keyColumn: k.column, keyParam: k.param, keySource: k.source, actions: [...types].map(([label, type]) => ({ label, type })), add: t.add?.label ?? null, paged: !!t.next, rows: t.rows.length });
    }
    return [...this.models.values()];
  }

  summary(): TableModel[] {
    return [...this.models.values()];
  }

  // ---------- reading ----------

  private need(): Page {
    const p = this.getPage();
    if (!p) throw new Error("Nothing compiled yet. Call compile_site first.");
    return p;
  }

  private async rawTables(page: Page): Promise<RawTable[]> {
    return (await page.evaluate(TABLES_SCRIPT)) as RawTable[];
  }

  /** Every row of a kind, following "next" links (capped). Returns where each row lives so an action can find it. */
  private async scan(kind: Kind, maxPages = 10): Promise<{ recs: Rec[]; where: { url: string; ri: number; table: RawTable; key: KeyInfo }[] }> {
    const m = this.models.get(kind);
    if (!m) throw new Error(`unknown kind ${kind}`);
    const page = this.need();
    const recs: Rec[] = [];
    const where: { url: string; ri: number; table: RawTable; key: KeyInfo }[] = [];
    let url: string | null = m.url;
    for (let p = 0; url && p < maxPages; p++) {
      if (page.url() !== url) await page.goto(url, { waitUntil: "load" });
      const t = (await this.rawTables(page)).find((x) => x.index === m.tableIndex);
      if (!t) break;
      const k = findKey(t);
      const cols = dataColumns(t);
      t.rows.forEach((_, ri) => { const r = toRecord(t, k, ri, cols); if (r) { recs.push(r); where.push({ url: page.url(), ri, table: t, key: k }); } });
      url = t.next && t.next !== page.url() ? t.next : null;
    }
    return { recs, where };
  }

  kinds(): Kind[] {
    return [...this.models.keys()];
  }

  async list(kind: Kind, filter?: Record<string, unknown>): Promise<Rec[]> {
    const { recs } = await this.scan(kind);
    return filter ? recs.filter((r) => Object.entries(filter).every(([f, v]) => r[f] === v)) : recs;
  }

  async read(kind: Kind, key: string): Promise<Rec | null> {
    const real = this.aliases.get(`${kind}:${key}`) ?? key;
    const { recs } = await this.scan(kind);
    const hit = recs.find((r) => r.key === real) ?? null;
    return hit ? { ...hit, key } : null;
  }

  async counts(forKind?: Kind): Promise<Record<Kind, number>> {
    const out: Record<Kind, number> = {};
    for (const k of forKind ? [forKind] : this.kinds()) {
      if (!this.models.has(k)) continue;
      try { out[k] = (await this.scan(k)).recs.length; } catch { /* a page that no longer loads is skipped, not fatal */ }
    }
    return out;
  }

  async exportAll(forKind?: Kind): Promise<Record<Kind, Rec[]>> {
    const out: Record<Kind, Rec[]> = {};
    for (const k of forKind ? [forKind] : this.kinds()) {
      if (!this.models.has(k)) continue;
      try { out[k] = (await this.scan(k)).recs; } catch { /* skipped */ }
    }
    return out;
  }

  // ---------- writing ----------

  async delete(kind: Kind, key: string): Promise<void> {
    const page = this.need();
    const real = this.aliases.get(`${kind}:${key}`) ?? key;
    const { recs, where } = await this.scan(kind);
    const i = recs.findIndex((r) => r.key === real);
    if (i < 0) throw new Error(`${kind} ${key} not found`);
    const w = where[i]!;
    const row = w.table.rows[w.ri]!;
    const ai = row.actions.findIndex((a) => classifyAction(a) === "delete");
    if (ai < 0) throw new Error(`no delete action found on the row for ${kind} ${key}`);
    if (page.url() !== w.url) await page.goto(w.url, { waitUntil: "load" });
    const before = page.url();
    this.hookDialogs(page);
    this.expectDialog = true;
    try {
      await this.stampAndClick(page, w.table.index, w.ri, ai);
      await page.waitForLoadState("load").catch(() => undefined);
      await page.waitForTimeout(150);
    } finally { this.expectDialog = false; }
    // A confirmation page or panel: press the confirm button, never cancel.
    if (page.url() !== before) await this.confirmIfAsked(page);
  }

  private async confirmIfAsked(page: Page): Promise<void> {
    const forms = (await explorePage(page)).forms;
    const f = forms.find((x) => x.submit);
    if (!f?.submit) return;
    if (/cancel|back|no\b/i.test(f.submit.label) && !/yes|confirm|delete|remove/i.test(f.submit.label)) return;
    await Promise.all([
      page.waitForLoadState("load").catch(() => undefined),
      page.locator(f.selector).locator(f.submit.selector).first().click(),
    ]);
  }

  private async stampAndClick(page: Page, tableIndex: number, ri: number, ai: number): Promise<void> {
    const ok = await page.evaluate(`((a) => {
      var t = document.querySelectorAll("table")[a.t];
      var headRow = t.querySelector("thead tr");
      if (!headRow) { var r0 = t.querySelector("tr"); if (r0 && r0.querySelector("th")) headRow = r0; }
      var trs = Array.prototype.filter.call(t.querySelectorAll("tr"), function (r) { return r !== headRow && r.querySelectorAll("td").length > 0; });
      var els = trs[a.r].querySelectorAll('a[href], button, input[type=submit], input[type=button], [role=button], [onclick]');
      var el = els[a.a]; if (!el) return false;
      el.setAttribute("data-wicket-target", "1"); return true;
    })(${JSON.stringify({ t: tableIndex, r: ri, a: ai })})`);
    if (!ok) throw new Error("could not find the row action on the page");
    try { await page.locator('[data-wicket-target="1"]').first().click(); }
    finally { await page.evaluate(`document.querySelectorAll("[data-wicket-target]").forEach(function(e){e.removeAttribute("data-wicket-target")})`).catch(() => undefined); }
  }

  async create(kind: Kind, record: Rec): Promise<void> {
    const m = this.models.get(kind);
    const page = this.need();
    if (!m) throw new Error(`unknown kind ${kind}`);
    if (page.url() !== m.url) await page.goto(m.url, { waitUntil: "load" });
    const t = (await this.rawTables(page)).find((x) => x.index === m.tableIndex);
    if (!t?.add) throw new Error(`no add button found for ${kind}`);
    const oldKeys = new Set((await this.scan(kind)).recs.map((r) => r.key));
    if (page.url() !== m.url) await page.goto(m.url, { waitUntil: "load" });
    const addLabel = t.add.label;
    await Promise.all([
      page.waitForLoadState("load").catch(() => undefined),
      page.getByRole(/button|submit/i.test(addLabel) ? "button" : "link", { name: addLabel }).first().click().catch(async () => { await page.getByText(addLabel, { exact: false }).first().click(); }),
    ]);
    await page.waitForTimeout(100);
    const forms = (await explorePage(page)).forms;
    const f: FormModel | undefined = forms.find((x) => x.fields.length > 0);
    if (!f || !f.submit) throw new Error("the add page has no form to fill");
    // Match record fields to form fields by name, label, or the column they came from. Never by position.
    const scope = page.locator(f.selector);
    for (const [col, raw] of Object.entries(record)) {
      if (col === "key") continue;
      const field = f.fields.find((x) => norm(x.name) === norm(col) || norm(x.label) === norm(col));
      if (!field) continue;
      const loc = scope.locator(`[name="${field.ref}"]`).first();
      if (field.type === "select") await loc.selectOption({ label: String(raw) }).catch(async () => { await loc.selectOption(String(raw)); });
      else if (field.type === "checkbox") await loc.setChecked(String(raw).toLowerCase() === "true" || raw === true);
      else if (field.type === "radio") await scope.locator(`input[type=radio][name="${field.ref}"][value="${String(raw)}"]`).check().catch(() => undefined);
      else await loc.fill(String(raw ?? ""));
    }
    await Promise.all([
      page.waitForLoadState("load").catch(() => undefined),
      scope.locator(f.submit.selector).first().click(),
    ]);
    // Remember where the new row landed, so an undo of a delete can find it by its old key.
    const after = (await this.scan(kind)).recs;
    const fresh = after.find((r) => !oldKeys.has(r.key) && Object.entries(record).every(([c, v]) => c === "key" || c === m.keyColumn || String(r[c] ?? "") === String(v ?? "")));
    if (fresh && fresh.key !== record.key) this.aliases.set(`${kind}:${record.key}`, fresh.key);
  }

  async pendingPublish(): Promise<string[]> {
    return [];
  }
  async publish(): Promise<{ published: number; notified: number }> {
    return { published: 0, notified: 0 };
  }
  /** Forget what was compiled. */
  async reset(): Promise<void> {
    this.aliases.clear();
    this.models.clear();
  }
}

export { assertAuthorized };
