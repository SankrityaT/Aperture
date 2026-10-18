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
  next: string | null; adds: { label: string; href: string; index: number }[];
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
    var allRows = Array.prototype.slice.call(t.rows);
    var headIdx = -1;
    for (var hi = 0; hi < allRows.length; hi++) { if (allRows[hi].querySelector(":scope > th")) { headIdx = hi; break; } }
    if (headIdx < 0) return;
    var headRow = allRows[headIdx];
    var headers = Array.prototype.map.call(headRow.children, function (c) { return clean(c.innerText); });
    var trs = allRows.slice(headIdx + 1).filter(function (r) { return r.querySelectorAll(":scope > td").length > 0; });
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
    if (!next) {
      // Pagination by a page-number parameter: the nearest higher page of the same list.
      var cur = new URL(location.href), best = null;
      links.forEach(function (l) {
        try {
          var u = new URL(l.getAttribute("href"), location.href);
          if (u.pathname !== cur.pathname) return;
          u.searchParams.forEach(function (v, k) {
            if (!/^(page|p|pg|paged|pagenum|pageno|start|offset)$/i.test(k) || !/^\\d+$/.test(v)) return;
            var cv = cur.searchParams.get(k);
            var c = cv && /^\\d+$/.test(cv) ? Number(cv) : 0;
            if (Number(v) > c && (!best || Number(v) < best.v)) best = { v: Number(v), href: u.href };
          });
        } catch (e) {}
      });
      if (best) next = best.href;
    }
    var adds = [];
    var cands = Array.prototype.slice.call(document.querySelectorAll('a[href], button, input[type=submit], input[type=button], [role=button]'));
    for (var j = 0; j < cands.length; j++) {
      var c = cands[j];
      if (t.contains(c)) continue;
      var cl = labelOf(c);
      if (/^(\\+|add|new|create|register|invite)\\b/i.test(cl) || /\\b(add|new|create) /i.test(cl)) adds.push({ label: cl, href: c.getAttribute("href") ? abs(c.getAttribute("href")) : "", index: j });
    }
    out.push({ index: ti, title: title, headers: headers, rows: rows, next: next, adds: adds });
  });
  return out;
})()`;

const PAGE_ACTIONS_SCRIPT = `(() => {
  var clean = function (s) { return (s == null ? "" : String(s)).replace(/\\s+/g, " ").trim(); };
  var abs = function (h) { try { return new URL(h, location.href).href; } catch (e) { return h || ""; } };
  var labelOf = function (a) {
    var l = clean(a.innerText || a.value || "");
    if (l) return l;
    l = clean(a.getAttribute("title") || a.getAttribute("aria-label") || "");
    if (l) return l;
    var img = a.querySelector("img[alt]");
    return img ? clean(img.getAttribute("alt")) : "";
  };
  Array.prototype.forEach.call(document.querySelectorAll("[data-wicket-i]"), function (e) { e.removeAttribute("data-wicket-i"); });
  var std = 'a[href], button, input[type=submit], input[type=button], [role=button], [onclick]';
  var seen = [];
  var add = function (el) { if (seen.indexOf(el) < 0) seen.push(el); };
  Array.prototype.forEach.call(document.querySelectorAll(std), add);
  // Controls wired up by script have no link or button tag. The browser still shows them with a pointer cursor.
  Array.prototype.forEach.call(document.querySelectorAll("span, div, li, i, img, td, label"), function (el) {
    if (seen.indexOf(el) >= 0) return;
    var txt = clean(el.innerText || el.getAttribute("title") || el.getAttribute("aria-label") || "");
    if (!txt || txt.length > 30) return;
    if (getComputedStyle(el).cursor !== "pointer") return;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === "pointer" && seen.indexOf(el.parentElement) >= 0) return;
    add(el);
  });
  return seen.map(function (a, i) {
    a.setAttribute("data-wicket-i", String(i));
    return { label: labelOf(a), href: a.getAttribute("href") ? abs(a.getAttribute("href")) : "", onclick: clean(a.getAttribute("onclick") || "").slice(0, 160), cls: clean(a.className || "") + " " + (a.id || ""), tag: a.tagName.toLowerCase() };
  });
})()`;

const MODAL_SCRIPT = `(() => {
  var vis = function (e) { var r = e.getBoundingClientRect(); var st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
  var boxes = Array.prototype.slice.call(document.querySelectorAll('[role=dialog], [role=alertdialog], .ui-dialog, .modal, .swal2-popup, .bootbox, .confirm'));
  for (var i = 0; i < boxes.length; i++) {
    var c = boxes[i];
    if (!vis(c)) continue;
    var btns = Array.prototype.slice.call(c.querySelectorAll('button, input[type=button], input[type=submit], a.btn, [role=button]')).filter(vis);
    var yes = btns.filter(function (b) {
      var l = (b.innerText || b.value || "").toLowerCase().trim();
      return /(^|[^a-z])(yes|confirm|delete|remove|ok|continue|proceed)([^a-z]|$)/.test(l) && !/(cancel|close|back)/.test(l) && l !== "no";
    })[0];
    if (yes) { yes.setAttribute("data-wicket-target", "1"); return true; }
  }
  return false;
})()`;

// ---- what an action label means ----

export function classifyAction(a: Pick<RawAction, "label" | "href" | "onclick" | "cls">): ActionType {
  const hay = `${a.label} ${a.href} ${a.onclick} ${a.cls}`.toLowerCase();
  if (/(^|[^a-z])(delete|remove|trash|destroy|discard|erase|bin)([^a-z]|$)|fa-trash|fa-times|icon-trash/.test(hay)) return "delete";
  if (/(^|[^a-z])(edit|modify|update|change|manage|configure)([^a-z]|$)|fa-pen|fa-edit/.test(hay)) return "edit";
  if (/(^|[^a-z])(view|details?|open|show|profile|select)([^a-z]|$)/.test(hay)) return "view";
  return "other";
}

/** Pick the add button that belongs to this table. Candidates are scored, never taken first-come. */
export function pickAdd(title: string, adds: { label: string; href: string }[]): { label: string; href: string } | null {
  const words = title.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).map((w) => w.replace(/s$/, ""));
  let best: { label: string; href: string } | null = null;
  let bestScore = 0;
  for (const a of adds) {
    const l = a.label.toLowerCase();
    let sc = 0;
    if (/^(new|create|add|\+)/.test(l)) sc += 2;
    if (words.some((w) => l.includes(w))) sc += 3;
    if (/(new|create|add)/.test(a.href.toLowerCase())) sc += 2;
    if (/bookmark|favorite|favourite|shortcut|wishlist|compare|cart|to list|to page|subscribe|add to/.test(l)) sc -= 6;
    if (sc > bestScore) { best = a; bestScore = sc; }
  }
  return bestScore >= 3 ? best : null;
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
  // Only real verbs (delete, edit, view...) mark an actions column. A company name that happens to be a link is data.
  const acts = new Set(t.rows.flatMap((r) => r.actions.filter((a) => classifyAction(a) !== "other").map((a) => a.label.toLowerCase())).filter(Boolean));
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
      for (const r of t.rows) for (const a of r.actions) {
        if (a.label && r.cells.includes(a.label) && classifyAction(a) === "other") continue; // a link whose text is the record's own data
        const label = a.label || a.cls || a.tag;
        if (!types.has(label)) types.set(label, classifyAction(a));
      }
      const add = pickAdd(t.title, t.adds);
      this.models.set(id, { id, url: page.url(), tableIndex: t.index, title: t.title, columns: cols.map((i) => t.headers[i]!), keyColumn: k.column, keyParam: k.param, keySource: k.source, actions: [...types].map(([label, type]) => ({ label, type })).filter((a) => a.type !== "other"), add: add?.label ?? null, paged: !!t.next, rows: t.rows.length });
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
      // The key chosen when the page was compiled stays the key. Recomputing it each time would change it
      // whenever the data does (one empty cell is enough), and every plan made earlier would point at nothing.
      let k: KeyInfo;
      const ci = m.keyColumn ? t.headers.indexOf(m.keyColumn) : -1;
      if (m.keySource === "column" && ci >= 0) k = { column: m.keyColumn, columnIndex: ci, param: null, source: "column" };
      else if (m.keySource === "link" && m.keyParam) k = { column: null, columnIndex: -1, param: m.keyParam, source: "link" };
      else k = findKey(t);
      const cols = dataColumns(t);
      t.rows.forEach((_, ri) => { const r = toRecord(t, k, ri, cols); if (r) { recs.push(r); where.push({ url: page.url(), ri, table: t, key: k }); } }); // a row with no key value cannot be addressed, so it is left out
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
    if (page.url() !== w.url) await page.goto(w.url, { waitUntil: "load" });
    this.hookDialogs(page);
    const ai = row.actions.findIndex((a) => classifyAction(a) === "delete");
    if (ai >= 0) {
      await this.pressAndConfirm(page, () => this.stampAndClick(page, w.table.index, w.ri, ai));
      return;
    }
    // No delete on the list. Many apps keep it on the record's own page, so follow the row's link and look there.
    const usable = (a: RawAction) => !!a.href && !/^(javascript:|#)/i.test(a.href);
    const detail = row.actions.find((a) => usable(a) && a.label && row.cells.includes(a.label)) ?? row.actions.find((a) => usable(a) && classifyAction(a) === "view") ?? row.actions.find(usable);
    if (!detail) throw new Error(`no delete action on the row, and no link to the record's own page, for ${kind} ${key}`);
    await page.goto(detail.href, { waitUntil: "load" });
    const di = (await this.pageActions(page)).findIndex((a) => classifyAction(a) === "delete");
    if (di < 0) throw new Error(`no delete action found on the record's own page for ${kind} ${key}`);
    await this.pressAndConfirm(page, () => this.stampPageAction(page, di));
  }

  /** Press a delete control and answer whatever confirmation follows: a browser dialog, a modal, or a confirm page. Never cancel. */
  private async pressAndConfirm(page: Page, click: () => Promise<void>): Promise<void> {
    const before = page.url();
    this.expectDialog = true;
    try {
      await click();
      await page.waitForLoadState("load").catch(() => undefined);
      await page.waitForTimeout(250);
    } finally { this.expectDialog = false; }
    if (await this.confirmModal(page)) {
      await page.waitForLoadState("load").catch(() => undefined);
      await page.waitForTimeout(250);
      return;
    }
    if (page.url() !== before) await this.confirmIfAsked(page);
  }

  private async pageActions(page: Page): Promise<RawAction[]> {
    return (await page.evaluate(PAGE_ACTIONS_SCRIPT)) as RawAction[];
  }

  private async stampPageAction(page: Page, index: number): Promise<void> {
    // pageActions() stamped every control it found with data-wicket-i, so click by that index.
    const loc = page.locator(`[data-wicket-i="${index}"]`).first();
    if ((await loc.count()) === 0) throw new Error("could not find that control on the page");
    try { await loc.click(); }
    finally { await page.evaluate(`document.querySelectorAll("[data-wicket-i]").forEach(function(e){e.removeAttribute("data-wicket-i")})`).catch(() => undefined); }
  }

  /** If a visible modal is asking "are you sure", press its confirm button (yes, confirm, delete, ok). Never its cancel. */
  private async confirmModal(page: Page): Promise<boolean> {
    const found = await page.evaluate(MODAL_SCRIPT);
    if (!found) return false;
    try { await page.locator('[data-wicket-target="1"]').first().click(); }
    finally { await page.evaluate(`document.querySelectorAll("[data-wicket-target]").forEach(function(e){e.removeAttribute("data-wicket-target")})`).catch(() => undefined); }
    return true;
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
      var allRows = Array.prototype.slice.call(t.rows);
      var headIdx = -1;
      for (var hi = 0; hi < allRows.length; hi++) { if (allRows[hi].querySelector(":scope > th")) { headIdx = hi; break; } }
      var trs = allRows.slice(headIdx + 1).filter(function (r) { return r.querySelectorAll(":scope > td").length > 0; });
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
    const add = t ? pickAdd(t.title, t.adds) : null;
    if (!add) throw new Error(`no add button found for ${kind}`);
    const oldKeys = new Set((await this.scan(kind)).recs.map((r) => r.key));
    if (page.url() !== m.url) await page.goto(m.url, { waitUntil: "load" });
    const addLabel = add.label;
    if (add.href && !/^(javascript:|#)/i.test(add.href)) await page.goto(add.href, { waitUntil: "load" });
    else await Promise.all([
      page.waitForLoadState("load").catch(() => undefined),
      page.getByRole(/button|submit/i.test(addLabel) ? "button" : "link", { name: addLabel }).first().click().catch(async () => { await page.getByText(addLabel, { exact: false }).first().click(); }),
    ]);
    await page.waitForTimeout(100);
    const forms = (await explorePage(page)).forms;
    // The page also has a search box and menus. The form to fill is the one with a submit button and the most fields.
    const f: FormModel | undefined = forms.filter((x) => x.submit && x.fields.length > 0).sort((a, b) => b.fields.length - a.fields.length)[0];
    if (!f || !f.submit) throw new Error("the add page has no form to fill");
    // Match record fields to form fields by name, label, or the column they came from. Never by position.
    const scope = page.locator(f.selector);
    const skipped: string[] = [];
    for (const [col, raw] of Object.entries(record)) {
      if (col === "key") continue;
      const exact = f.fields.find((x) => norm(x.name) === norm(col) || norm(x.label) === norm(col));
      // Looser, but only when it is unambiguous: one field whose label starts with, or contains, the column's name.
      const loose = f.fields.filter((x) => norm(col).length >= 4 && (norm(x.label).startsWith(norm(col)) || norm(x.label).includes(norm(col))));
      const field = exact ?? (loose.length === 1 ? loose[0] : undefined);
      if (!field) continue;
      const loc = scope.locator(`[name="${field.ref}"]`).first();
      const T = { timeout: 2000 };
      try {
        if (field.type === "select") await loc.selectOption({ label: String(raw) }, T).catch(async () => { await loc.selectOption(String(raw), T); });
        else if (field.type === "checkbox") await loc.setChecked(String(raw).toLowerCase() === "true" || raw === true, T);
        else if (field.type === "radio") await scope.locator(`input[type=radio][name="${field.ref}"][value="${String(raw)}"]`).check(T);
        else await loc.fill(String(raw ?? ""), T);
      } catch { skipped.push(col); } // a value the form has no matching option for is skipped, and reported
    }
    const addUrl = page.url();
    await Promise.all([
      page.waitForLoadState("load").catch(() => undefined),
      scope.locator(f.submit.selector).first().click(),
    ]);
    await page.waitForTimeout(200);
    // Still on the add form? Then the app refused it. Say why, in the app's own words.
    const stillForm = (await explorePage(page)).forms.some((x) => x.fields.length >= Math.max(2, f.fields.length - 1) && !!x.submit);
    if (page.url() === addUrl || stillForm) {
      const msg = await page.evaluate(`(() => { var e = document.querySelectorAll('.error, .errors, .alert-danger, .warning, [role=alert], .ui-state-error, .jnotify-container, .jnotify-message'); return Array.prototype.map.call(e, function (x) { return (x.innerText || '').replace(/\\s+/g, ' ').trim(); }).filter(Boolean).slice(0, 3).join(' | ').slice(0, 300); })()`) as string;
      if (msg || page.url() === addUrl) throw new Error(`the app did not accept the new record${msg ? `: ${msg}` : ""}${skipped.length ? ` (could not fill: ${skipped.join(", ")})` : ""}`);
    }
    // Remember where the new row landed, so an undo of a delete can find it by its old key.
    const after = (await this.scan(kind)).recs;
    // The new row is the one key that was not there before. If several appeared, match on the values we typed in.
    const added = after.filter((r) => !oldKeys.has(r.key));
    const fresh = added.length === 1 ? added[0] : added.find((r) => Object.entries(record).every(([c, v]) => c === "key" || c === m.keyColumn || skipped.includes(c) || String(r[c] ?? "") === String(v ?? "")));
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
