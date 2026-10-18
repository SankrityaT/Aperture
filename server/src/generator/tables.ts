// Generic record lists. Anything that looks like a list of records becomes a "kind": an HTML table, an ARIA grid of
// divs, or any container whose children repeat with the same structure. Nothing here knows any particular system.
// It finds, by structure alone:
//   - the columns (header text, or synthesized from the cells' class names)
//   - a stable key (a unique id-like column, or a unique id inside the row's own links)
//   - the row actions, classified by what their label means (delete, edit, view)
//   - the "add" button, and how to reach more rows: a next link, a pager control, or scrolling
// It reaches into open shadow roots and into iframes, and waits for the page to settle before reading.
// Delete is "click the row's delete action, answer the confirmation". Create is "click add, fill the form, submit".
// Both are read back from the list afterwards.

import type { Frame, Page } from "playwright-core";
import type { Adapter, Kind, Rec } from "../types.js";
import { explorePage, type FieldModel, type FormModel } from "./explore.js";
import { assertAuthorized } from "./form-adapter.js";

export type ActionType = "delete" | "edit" | "view" | "other";

export interface RawAction { label: string; href: string; onclick: string; cls: string; tag: string }
export interface RawRow { cells: string[]; actions: RawAction[] }
export interface RawTable {
  index: number; kind: string; sig: string; title: string; headers: string[]; rows: RawRow[];
  next: string | null; canNext: boolean; adds: { label: string; href: string; index: number }[];
}

export interface TableModel {
  id: string; url: string; tableIndex: number; sig: string; shape: string; title: string;
  frame: string | null; frameName: string;
  columns: string[]; keyColumn: string | null; keyParam: string | null; keySource: "column" | "link" | "none";
  actions: { label: string; type: ActionType }[]; add: string | null; paged: boolean; scrolls: boolean; rows: number;
}

/** A compiled capability no longer matches the page. The engine turns this into a disabled capability, never a retry. */
export type DriftClass = "ui_changed" | "auth" | "transient";
export interface DriftItem { what: string; expected?: unknown; observed?: unknown; blocking: boolean }
export class CapabilityDrift extends Error {
  constructor(readonly kind: string, readonly klass: DriftClass, readonly drifts: DriftItem[], message: string) { super(message); this.name = "CapabilityDrift"; }
}

const normHead = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const overlap = (a: string[], b: string[]) => { const A = new Set(a.map(normHead).filter(Boolean)); const B = new Set(b.map(normHead).filter(Boolean)); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / Math.max(A.size, B.size); };

// ---- the in-page reader. Plain JavaScript in strings on purpose (see explore.ts). String.raw keeps the regexes readable. ----

// Which rows of an HTML table are data. The header is the first row with header cells. Filter rows (form inputs, almost
// no text) and pager or footer rows (one wide cell) are not records. A row with a table inside one of SEVERAL cells is
// still a record: only a single wide cell holding a table is a pager.
const ROWS_FN = String.raw`var wicketRows = function (t) {
  var all = Array.prototype.slice.call(t.rows);
  var hi = -1;
  for (var i = 0; i < all.length; i++) { if (all[i].querySelector(":scope > th")) { hi = i; break; } }
  if (hi < 0) return null;
  var ncols = all[hi].children.length;
  var trs = all.slice(hi + 1).filter(function (r) {
    var tds = r.querySelectorAll(":scope > td");
    if (tds.length === 0) return false;
    for (var k = 0; k < tds.length; k++) {
      var cs = Number(tds[k].getAttribute("colspan") || 1);
      if (cs >= Math.max(2, ncols - 1)) return false;
      if (tds.length === 1 && tds[k].querySelector("table")) return false;
    }
    var withText = Array.prototype.filter.call(tds, function (c) { return c.innerText.trim() !== ""; }).length;
    if (withText < Math.ceil(tds.length / 2) && r.querySelector("input[type=text], input:not([type]), input[type=search], select")) return false;
    return true;
  });
  var others = all.slice(hi + 1).filter(function (r) { return trs.indexOf(r) < 0; });
  return { headRow: all[hi], trs: trs, others: others };
};`;

// Finds every grid on the page, in a fixed order, reaching through open shadow roots. Used when reading AND when
// clicking, so both always agree on which grid and which row is meant.
const GRID_LIB = String.raw`
var wicketClean = function (s) { return (s == null ? "" : String(s)).replace(/\s+/g, " ").trim(); };
var wicketGrids = function () {
  var clean = wicketClean;
  var deepAll = function (sel) {
    var out = [];
    var walk = function (root) {
      var f = root.querySelectorAll(sel);
      for (var i = 0; i < f.length; i++) out.push(f[i]);
      var all = root.querySelectorAll("*");
      for (var j = 0; j < all.length; j++) { if (all[j].shadowRoot) walk(all[j].shadowRoot); }
    };
    walk(document);
    return out;
  };
  var grids = [];
  var covered = function (el) { return grids.some(function (g) { return g.el.contains(el) || g.el === el; }); };
  var kids = function (r) { return Array.prototype.slice.call(r.children); };

  // 1. HTML tables with a header row
  deepAll("table").forEach(function (t) {
    var R = wicketRows(t);
    if (!R) return;
    grids.push({ kind: "table", el: t, rows: R.trs, others: R.others, headers: Array.prototype.map.call(R.headRow.children, function (c) { return clean(c.innerText); }), cells: kids });
  });

  // 2. ARIA grids made of divs
  deepAll("[role=grid], [role=table], [role=treegrid]").forEach(function (g) {
    if (g.tagName === "TABLE") return;
    var all = Array.prototype.slice.call(g.querySelectorAll("[role=row]"));
    var head = all.filter(function (r) { return r.querySelector("[role=columnheader]"); })[0];
    var data = all.filter(function (r) { return r !== head && !r.querySelector("[role=columnheader]") && r.querySelector("[role=gridcell], [role=cell], [role=rowheader]"); });
    if (!data.length) return;
    var cellsOf = function (r) {
      var c = Array.prototype.slice.call(r.querySelectorAll(":scope > [role=gridcell], :scope > [role=cell], :scope > [role=rowheader]"));
      return c.length ? c : kids(r);
    };
    var headers = head ? Array.prototype.map.call(head.querySelectorAll("[role=columnheader]"), function (c) { return clean(c.innerText); }) : cellsOf(data[0]).map(function (_, i) { return "col" + (i + 1); });
    grids.push({ kind: "aria", el: g, rows: data, others: [], headers: headers, cells: cellsOf });
  });

  // 3. any container whose children repeat with the same structure
  var sig = function (e) {
    return e.tagName + "." + Array.prototype.filter.call(e.classList, function (c) { return !/^(active|selected|odd|even|first|last|hover|focus|open|is-|has-)/.test(c); }).sort().join(".");
  };
  deepAll("div, ul, ol, section, main, article, tbody").forEach(function (box) {
    if (covered(box)) return;
    if (box.closest && box.closest("nav, header, footer, [role=navigation], [role=menu], [role=menubar], [role=tablist], [role=toolbar], [role=listbox], select")) return;
    var ks = kids(box);
    if (ks.length < 3) return;
    var groups = {};
    ks.forEach(function (k) { var s = sig(k); (groups[s] = groups[s] || []).push(k); });
    var best = null;
    Object.keys(groups).forEach(function (s) { var g = groups[s]; if (g.length >= 3 && (!best || g.length > best.length)) best = g; });
    if (!best) return;
    var counts = best.map(function (r) { return kids(r).filter(function (c) { return clean(c.innerText) !== "" || c.querySelector("button, a, input, img, svg"); }).length; });
    if (Math.min.apply(null, counts) < 2) return;
    var prev = best[0].previousElementSibling;
    var headers;
    if (prev && sig(prev) !== sig(best[0]) && prev.children.length === best[0].children.length && clean(prev.innerText) !== "") headers = kids(prev).map(function (c) { return clean(c.innerText); });
    else headers = kids(best[0]).map(function (c, i) { var cls = (c.className && c.classList && c.classList[0]) || ""; return cls ? String(cls) : "col" + (i + 1); });
    grids.push({ kind: "list", el: box, rows: best, others: [], headers: headers, cells: kids });
  });
  return grids;
};

var wicketDisabled = function (e) {
  return e.disabled === true || e.getAttribute("aria-disabled") === "true" || /(^|\s)(disabled|inactive)(\s|$)/.test(e.className || "") || !!(e.closest && e.closest(".disabled, [aria-disabled=true]"));
};

// The control that shows more rows: a "next" control, or the page number after the current one. Looks in the table's
// own pager rows first, then in the grid's surroundings.
var wicketFindNext = function (g) {
  var label = function (e) { return wicketClean(e.innerText || e.getAttribute("aria-label") || e.getAttribute("title") || e.value || ""); };
  var nextRe = /^(next|next page|older|>|›|»|→)$/i;
  var scopes = (g.others || []).slice();
  var node = g.el;
  for (var up = 0; up < 4 && node; up++) { node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null; if (node) scopes.push(node); }
  for (var s = 0; s < scopes.length; s++) {
    var cands = Array.prototype.slice.call(scopes[s].querySelectorAll("a, button, [role=button], li, span, input[type=button]")).filter(function (e) {
      return !g.el.contains(e) || (g.others || []).some(function (r) { return r.contains(e); });
    });
    var byLabel = cands.filter(function (e) {
      var al = (e.getAttribute("aria-label") || "").toLowerCase();
      return (nextRe.test(label(e)) || al.indexOf("next") >= 0) && !e.querySelector("a, button");
    })[0];
    if (byLabel) return wicketDisabled(byLabel) ? null : byLabel;
    var nums = cands.filter(function (e) { return /^[0-9]+$/.test(label(e)) && !e.querySelector("a, button, span, li"); });
    var cur = nums.filter(function (e) {
      return e.getAttribute("aria-current") || /(^|\s)(current|active|selected)(\s|$)/.test(e.className || "") || (e.tagName !== "A" && e.tagName !== "BUTTON" && e.getAttribute("role") !== "button");
    })[0];
    if (cur) {
      var want = String(Number(label(cur)) + 1);
      var nx = nums.filter(function (e) { return label(e) === want && e !== cur; })[0];
      if (nx) return wicketDisabled(nx) ? null : nx;
    }
  }
  return null;
};
`;

const ACTION_SEL = String.raw`a[href], button, input[type=submit], input[type=button], [role=button], [onclick]`;

const TABLES_SCRIPT = String.raw`(() => {
  ${ROWS_FN}
  ${GRID_LIB}
  var clean = wicketClean;
  var abs = function (h) { try { return new URL(h, location.href).href; } catch (e) { return h || ""; } };
  var sel = '${ACTION_SEL}';
  var labelOf = function (a) {
    var l = clean(a.innerText || a.value || "");
    var d = clean(a.getAttribute("title") || a.getAttribute("aria-label") || "");
    if (d && (l.length <= 2 || !/[a-z0-9]/i.test(l))) return d; // a symbol such as x or a trash can is not a label; its title is
    if (l) return l;
    if (d) return d;
    var img = a.querySelector("img[alt]");
    if (img) return clean(img.getAttribute("alt"));
    return "";
  };
  var titleOf = function (g) {
    var el = g.el;
    var lab = el.getAttribute ? el.getAttribute("aria-label") : "";
    if (lab) return clean(lab);
    var lb = el.getAttribute ? el.getAttribute("aria-labelledby") : "";
    if (lb) { var t = clean(lb.split(" ").map(function (id) { var e = document.getElementById(id); return e ? e.innerText : ""; }).join(" ")); if (t) return t; }
    var cap = el.querySelector ? el.querySelector("caption") : null;
    if (cap) return clean(cap.innerText);
    var node = el;
    for (var up = 0; up < 5 && node; up++) {
      var prev = node.previousElementSibling;
      while (prev) {
        if (/^H[1-6]$/.test(prev.tagName)) return clean(prev.innerText);
        var h = prev.querySelector ? prev.querySelector("h1, h2, h3, h4") : null;
        if (h) return clean(h.innerText);
        prev = prev.previousElementSibling;
      }
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    }
    return clean(document.title);
  };
  var grids = wicketGrids();
  var links = Array.prototype.slice.call(document.querySelectorAll("a[href]"));
  return grids.map(function (g, gi) {
    var rows = g.rows.map(function (r) {
      var cells = g.cells(r).map(function (c) { return clean(c.innerText); });
      var actions = Array.prototype.map.call(r.querySelectorAll(sel), function (a) {
        return { label: labelOf(a), href: a.getAttribute("href") ? abs(a.getAttribute("href")) : "", onclick: clean(a.getAttribute("onclick") || "").slice(0, 160), cls: clean(a.className || ""), tag: a.tagName.toLowerCase() };
      });
      return { cells: cells, actions: actions };
    });
    var next = null;
    for (var i = 0; i < links.length; i++) {
      var l = links[i], txt = clean(l.innerText), aria = (l.getAttribute("aria-label") || "").toLowerCase(), href = l.getAttribute("href") || "";
      if (/^(javascript:|#)/i.test(href)) continue;
      if (l.getAttribute("rel") === "next" || /^(next|older)\b/i.test(txt) || /^[>›»]+$/.test(txt) || aria.indexOf("next") >= 0) { next = abs(href); break; }
    }
    if (!next) {
      // Pagination by a page-number parameter: the nearest higher page of the same list.
      var cur = new URL(location.href), best = null;
      links.forEach(function (l) {
        try {
          var u = new URL(l.getAttribute("href"), location.href);
          if (u.pathname !== cur.pathname) return;
          u.searchParams.forEach(function (v, k) {
            if (!/^(page|p|pg|paged|pagenum|pageno|start|offset)$/i.test(k) || !/^\d+$/.test(v)) return;
            var cv = cur.searchParams.get(k);
            var c = cv && /^\d+$/.test(cv) ? Number(cv) : 0;
            if (Number(v) > c && (!best || Number(v) < best.v)) best = { v: Number(v), href: u.href };
          });
        } catch (e) {}
      });
      if (best) next = best.href;
    }
    var canNext = !next && !!wicketFindNext(g);
    var adds = [];
    var cands = Array.prototype.slice.call(document.querySelectorAll('a[href], button, input[type=submit], input[type=button], [role=button]'));
    for (var j = 0; j < cands.length; j++) {
      var c = cands[j];
      if (g.el.contains(c)) continue;
      var cl = labelOf(c);
      if (/^(\+|add|new|create|register|invite)\b/i.test(cl) || /\b(add|new|create) /i.test(cl)) adds.push({ label: cl, href: c.getAttribute("href") ? abs(c.getAttribute("href")) : "", index: j });
    }
    return { index: gi, kind: g.kind, sig: g.headers.join("|") + "#" + g.kind, title: titleOf(g), headers: g.headers, rows: rows, next: next, canNext: canNext, adds: adds };
  });
})()`;

// Stamp the row action we want so Playwright can click it with a real click.
const actScript = (a: { t: number; r: number; a: number }) => String.raw`((a) => {
  ${ROWS_FN}
  ${GRID_LIB}
  var g = wicketGrids()[a.t];
  if (!g) return false;
  var row = g.rows[a.r];
  if (!row) return false;
  var el = row.querySelectorAll('${ACTION_SEL}')[a.a];
  if (!el) return false;
  el.setAttribute("data-wicket-target", "1");
  return true;
})(${JSON.stringify(a)})`;

// Stamp the control that shows the next rows.
const nextScript = (t: number) => String.raw`((t) => {
  ${ROWS_FN}
  ${GRID_LIB}
  var g = wicketGrids()[t];
  if (!g) return false;
  var el = wicketFindNext(g);
  if (!el) return false;
  el.setAttribute("data-wicket-target", "1");
  return true;
})(${t})`;

// Scroll the grid's scrollable surroundings (or the window) to the bottom, so a list that loads on scroll shows more.
const scrollScript = (t: number) => String.raw`((t) => {
  ${ROWS_FN}
  ${GRID_LIB}
  var g = wicketGrids()[t];
  var node = g ? g.el : null;
  while (node && node !== document.body) {
    var st = getComputedStyle(node);
    if (/(auto|scroll)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 2) { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event("scroll")); return true; }
    node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
  }
  window.scrollTo(0, document.documentElement.scrollHeight);
  var last = g && g.rows[g.rows.length - 1];
  if (last && last.scrollIntoView) last.scrollIntoView({ block: "end" });
  return false;
})(${t})`;

// Resolves once the page has stopped changing for a moment, so a late-rendering page is read after it renders.
const quietScript = (quietMs: number, maxMs: number) => String.raw`new Promise(function (resolve) {
  var done = function () { try { mo.disconnect(); } catch (e) {} clearTimeout(cap); clearTimeout(q); resolve(true); };
  var cap = setTimeout(done, ${maxMs});
  var q = setTimeout(done, ${quietMs});
  var mo = new MutationObserver(function () { clearTimeout(q); q = setTimeout(done, ${quietMs}); });
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
})`;

const PAGE_ACTIONS_SCRIPT = String.raw`(() => {
  var clean = function (s) { return (s == null ? "" : String(s)).replace(/\s+/g, " ").trim(); };
  var abs = function (h) { try { return new URL(h, location.href).href; } catch (e) { return h || ""; } };
  var labelOf = function (a) {
    var l = clean(a.innerText || a.value || "");
    var d = clean(a.getAttribute("title") || a.getAttribute("aria-label") || "");
    if (d && (l.length <= 2 || !/[a-z0-9]/i.test(l))) return d;
    if (l) return l;
    if (d) return d;
    var img = a.querySelector("img[alt]");
    return img ? clean(img.getAttribute("alt")) : "";
  };
  Array.prototype.forEach.call(document.querySelectorAll("[data-wicket-i]"), function (e) { e.removeAttribute("data-wicket-i"); });
  var std = '${ACTION_SEL}';
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

const MODAL_SCRIPT = String.raw`(() => {
  var vis = function (e) { var r = e.getBoundingClientRect(); var st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
  var boxes = Array.prototype.slice.call(document.querySelectorAll('[role=dialog], [role=alertdialog], dialog[open], .ui-dialog, .modal, .swal2-popup, .bootbox, .confirm'));
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
  // Only real verbs (delete, edit, view...) mark an actions column, judged by the words on the link, not its address: a name that links to /profile?id=2 is data. A company name that happens to be a link is data.
  const acts = new Set(t.rows.flatMap((r) => r.actions.filter((a) => classifyAction({ label: a.label, href: "", onclick: "", cls: "" }) !== "other").map((a) => a.label.toLowerCase())).filter(Boolean));
  const idx: number[] = [];
  t.headers.forEach((h, i) => {
    if (!h) return;
    const vals = t.rows.map((r) => (r.cells[i] ?? "").toLowerCase());
    if (vals.length && vals.every((v) => v === "" || acts.has(v))) return; // an actions column
    idx.push(i);
  });
  return idx;
}

type Hop = { goto: string } | { click: true } | { scroll: number };
interface Where { route: Hop[]; ri: number; table: RawTable; key: KeyInfo }

export interface KeyInfo { column: string | null; columnIndex: number; param: string | null; source: "column" | "link" | "none" }

/** A row with no text and no controls is padding (a placeholder, a spacer), not a record. A real row with a blank key is NOT blank: it still has other text. */
const isBlankRow = (r: RawRow) => r.cells.every((c) => (c ?? "").trim() === "") && r.actions.length === 0;

export function findKey(full: RawTable): KeyInfo {
  const t: RawTable = { ...full, rows: full.rows.filter((r) => !isBlankRow(r)) };
  const cols = dataColumns(t);
  const n = t.rows.length;
  const unique = (vals: (string | undefined)[]) => vals.length === n && vals.every((v) => !!v) && new Set(vals).size === n;
  // 1. a unique id-like column
  for (const i of cols) {
    if (/\b(id|code|key|number|no\.?|ref|username|email|login)\b/i.test(t.headers[i]!) && unique(t.rows.map((r) => r.cells[i]))) return { column: t.headers[i]!, columnIndex: i, param: null, source: "column" };
  }
  // 2. a unique value inside the row's own links
  for (const [param, vals] of linkParams(t.rows)) {
    if (!unique(vals)) continue;
    // If the same values are on screen in a column, that column is the key. It is the clearer, more honest handle.
    const same = cols.find((i) => t.rows.every((r, ri) => (r.cells[i] ?? "") === vals[ri]));
    if (same !== undefined) return { column: t.headers[same]!, columnIndex: same, param: null, source: "column" };
    if (/^(del|delete|remove|rm|action|cmd|op|do|mode|token|csrf|_)/i.test(param)) continue; // named for what it does, not for what it is
    return { column: null, columnIndex: -1, param, source: "link" };
  }
  // 3. among the unique columns, the one whose VALUES look like identifiers: short, no spaces, mostly digits.
  //    A name is unique too, but it is a poor key, so it only wins when nothing else looks like an id.
  const uniq = cols.filter((i) => unique(t.rows.map((r) => r.cells[i])));
  const idScore = (i: number) => {
    const vals = t.rows.map((r) => r.cells[i] ?? "");
    let sc = 0;
    if (vals.every((v) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,24}$/.test(v))) sc += 3;
    if (vals.filter((v) => /\d/.test(v)).length >= vals.length * 0.8) sc += 2;
    if (/\b(dir|id|code|no|num|ref|key)\b/i.test(t.headers[i]!)) sc += 1;
    return sc;
  };
  const ranked = [...uniq].sort((a, b) => idScore(b) - idScore(a) || a - b);
  if (ranked.length && idScore(ranked[0]!) >= 3) return { column: t.headers[ranked[0]!]!, columnIndex: ranked[0]!, param: null, source: "column" };
  // 4. any unique column
  for (const i of uniq) return { column: t.headers[i]!, columnIndex: i, param: null, source: "column" };
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
  /** A browser dialog is accepted only while a delete confirmation is expected. This is per PAGE and shared by every adapter on it, so one adapter's handler can never dismiss the confirmation another is waiting for. */
  private static dialogs = new WeakMap<Page, { expect: number }>();

  constructor(private readonly getPage: () => Page | null) {}

  private hookDialogs(page: Page): void {
    if (TableAdapter.dialogs.has(page)) return;
    const state = { expect: 0 };
    TableAdapter.dialogs.set(page, state);
    page.on("dialog", (d) => { (state.expect > 0 ? d.accept() : d.dismiss()).catch(() => undefined); });
  }

  private need(): Page {
    const p = this.getPage();
    if (!p) throw new Error("Nothing compiled yet. Call compile_site first.");
    return p;
  }

  // ---------- the page, settled ----------

  /** Wait for the page and all its frames to load, then to stop changing for a moment. Late-rendering pages need this. */
  private async settle(page: Page, quietMs = 300, maxMs = 4000): Promise<void> {
    await page.waitForLoadState("load").catch(() => undefined);
    await Promise.all(page.frames().map((f) => f.evaluate(quietScript(quietMs, maxMs)).catch(() => undefined)));
    await page.waitForTimeout(80); // changes inside shadow roots are not seen by the observer, so give them a moment
  }

  private async frameFor(m: TableModel): Promise<Frame> {
    const page = this.need();
    if (!m.frame) return page.mainFrame();
    for (let i = 0; i < 25; i++) {
      const f = page.frames().find((x) => x !== page.mainFrame() && (x.url() === m.frame || (m.frameName && x.name() === m.frameName)));
      if (f) return f;
      await page.waitForTimeout(120);
    }
    throw new Error("the frame this list lives in is not on the page");
  }

  private async rawTables(frame: Frame): Promise<RawTable[]> {
    return (await frame.evaluate(TABLES_SCRIPT)) as RawTable[];
  }

  private pickGrid(raw: RawTable[], m: Pick<TableModel, "sig" | "tableIndex"> & { columns?: string[] }): RawTable | undefined {
    const bySig = raw.find((x) => x.sig === m.sig);
    if (bySig) return bySig;
    const byPos = raw.find((x) => x.index === m.tableIndex);
    // Same position is not the same table. Accept it only if its headers still look like what was compiled.
    if (byPos && (!m.columns || overlap(byPos.headers, m.columns) >= 0.5)) return byPos;
    return undefined;
  }

  // ---------- compile ----------

  async attach(): Promise<TableModel[]> {
    this.memo.clear();
    const page = this.need();
    // Compiling a page replaces what was compiled from THAT page. Lists compiled from other pages stay, so an agent can work in several pages at once.
    const here = page.url();
    for (const [id, m] of [...this.models]) if (m.url === here) this.models.delete(id);
    await this.settle(page);
    // A grid with headers but no rows yet is usually still loading. Give it a few moments before deciding it is empty.
    for (let tries = 0; tries < 8; tries++) {
      const all = (await Promise.all(page.frames().map((f) => this.rawTables(f).catch(() => [] as RawTable[])))).flat();
      if (!all.some((t) => t.headers.filter(Boolean).length >= 2 && t.rows.length === 0)) break;
      await page.waitForTimeout(400);
    }
    const used = new Set<string>(this.models.keys());
    for (const frame of page.frames()) {
      let raw: RawTable[] = [];
      try { raw = await this.rawTables(frame); } catch { continue; }
      for (const t of raw) {
        if (t.headers.filter(Boolean).length < 2 || t.rows.length < 1) continue;
        const k = findKey(t);
        const cols = dataColumns(t);
        let id = slug(t.title) || `list${t.index + 1}`;
        while (used.has(id)) id += "_x";
        used.add(id);
        const types = new Map<string, ActionType>();
        for (const r of t.rows) for (const a of r.actions) {
          if (a.label && r.cells.includes(a.label) && classifyAction(a) === "other") continue; // a link whose text is the record's own data
          const label = a.label || a.cls || a.tag;
          if (!types.has(label)) types.set(label, classifyAction(a));
        }
        const add = pickAdd(t.title, t.adds);
        const isMain = frame === page.mainFrame();
        const model: TableModel = {
          id, url: page.url(), tableIndex: t.index, sig: t.sig, shape: t.kind, title: t.title,
          frame: isMain ? null : frame.url(), frameName: isMain ? "" : frame.name(),
          columns: cols.map((i) => t.headers[i]!), keyColumn: k.column, keyParam: k.param, keySource: k.source,
          actions: [...types].map(([label, type]) => ({ label, type })).filter((a) => a.type !== "other"),
          add: add?.label ?? null, paged: !!(t.next || t.canNext), scrolls: false, rows: t.rows.length,
        };
        // No pager? Then maybe more rows appear as you scroll. Try once, and remember the answer.
        if (!model.paged) {
          try { model.scrolls = (await this.scrollGrowth(frame, t.index, page, model)) > 0; } catch { /* leave it off */ }
        }
        this.models.set(id, model);
      }
    }
    return [...this.models.values()];
  }

  summary(): TableModel[] {
    return [...this.models.values()];
  }

  /** How many scrolls it takes until no new rows appear. 0 means scrolling shows nothing more. */
  private async scrollGrowth(frame: Frame, tableIndex: number, page: Page, m: Pick<TableModel, "sig" | "tableIndex">, max = 25): Promise<number> {
    let rows = this.pickGrid(await this.rawTables(frame), { sig: m.sig, tableIndex })?.rows.length ?? 0;
    let grew = 0;
    for (let i = 0; i < max; i++) {
      await frame.evaluate(scrollScript(tableIndex)).catch(() => undefined);
      await this.settle(page, 250, 2500);
      const now = this.pickGrid(await this.rawTables(frame), { sig: m.sig, tableIndex })?.rows.length ?? 0;
      if (now <= rows) break;
      rows = now;
      grew++;
    }
    return grew;
  }

  // ---------- reading ----------

  // A scan reads every page of a list, which is the slow part of verifying a change. Within one operation the same
  // list is read several times, so a scan is kept for a few seconds and dropped on any write. WICKET_SCAN_TTL_MS=0 turns it off.
  private memo = new Map<string, { at: number; v: { recs: Rec[]; where: Where[] } }>();
  /** What the last look at each list found that differs from the contract. Blocking items stop the capability. */
  private driftNotes = new Map<string, DriftItem[]>();
  /** A few real records seen by a scan that matched the contract: the regression set for any later repair. */
  private golden = new Map<string, Rec[]>();
  private readonly scanTtl = Number(process.env.WICKET_SCAN_TTL_MS ?? 3000);

  private async scan(kind: Kind, stopAt?: string, maxAgeMs?: number): Promise<{ recs: Rec[]; where: Where[] }> {
    const hit = this.memo.get(kind);
    // Reads that guard against stale plans use the short window. Counts, which only feed the before/after comparison, may use an older scan.
    if (this.scanTtl > 0 && hit && Date.now() - hit.at < Math.max(this.scanTtl, maxAgeMs ?? 0)) return hit.v;
    const { recs, where, partial } = await this.scanFresh(kind, 120, stopAt);
    const v = { recs, where };
    if (this.scanTtl > 0 && !partial) this.memo.set(kind, { at: Date.now(), v });
    if (!partial && recs.length > 0) this.checkIdentity(kind, recs);
    // Remember a few real records from a scan that matched the contract. A repair is later tested against them.
    if (!partial && recs.length > 0 && !(this.driftNotes.get(kind) ?? []).some((d) => d.blocking)) this.golden.set(kind, recs.slice(0, 6).map((r) => ({ ...r })));
    return v;
  }


  /**
   * Structure can stay identical while the MEANING of a key changes (ids reused or renumbered). Records seen earlier are the check:
   * if the same keys now hold completely different data, stop, because a change aimed at a key would hit a different record.
   */
  private checkIdentity(kind: Kind, recs: Rec[]): void {
    const golden = this.golden.get(kind);
    if (!golden || golden.length < 3) return;
    // A value equal to the key says nothing (the key is often one of the columns), so only the OTHER values count as evidence.
    const vals = (r: Rec) => Object.entries(r).filter(([f, v]) => f !== "key" && String(v ?? "").trim() !== "" && String(v).trim() !== String(r.key)).map(([, v]) => String(v).trim());
    const found = golden.map((g) => ({ g, r: recs.find((x) => x.key === g.key) })).filter((x): x is { g: Rec; r: Rec } => !!x.r);
    if (found.length < 3) return;
    const bad = found.filter(({ g, r }) => { const gv = vals(g); if (gv.length < 2) return false; const rv = new Set(vals(r)); return !gv.some((v) => rv.has(v)); });
    if (bad.length >= Math.max(2, Math.ceil(found.length / 2))) {
      const m = this.models.get(kind);
      const item: DriftItem = { what: "records with the same keys now hold different data: keys may have been reused or renumbered", expected: bad.slice(0, 2).map((b) => b.g), observed: bad.slice(0, 2).map((b) => b.r), blocking: true };
      this.driftNotes.set(kind, [item]);
      throw new CapabilityDrift(kind, "ui_changed", [item], `The same keys now identify different records in '${kind}'. Changes are stopped so one is not applied to the wrong record.${m ? "" : ""}`);
    }
  }

  invalidate(): void { this.memo.clear(); }

  // ---------- contract: is this compiled capability still true of the page? ----------

  private async driftFor(page: Page, m: TableModel, items: DriftItem[]): Promise<CapabilityDrift> {
    const signedOut = await page.evaluate(`!!document.querySelector('input[type="password"]')`).catch(() => false);
    const klass: DriftClass = signedOut ? "auth" : "ui_changed";
    const drifts = signedOut ? [{ what: "the page is asking for a sign-in", blocking: true }, ...items] : items;
    this.driftNotes.set(m.id, drifts);
    return new CapabilityDrift(m.id, klass, drifts, signedOut ? "The session looks signed out." : `The page no longer matches what was compiled for '${m.id}'.`);
  }

  /** Compare the table we found with the contract. Blocking differences throw; harmless ones are kept as notes. */
  private checkContract(m: TableModel, t: RawTable): void {
    const drifts: DriftItem[] = [];
    const has = (h: string) => t.headers.some((x) => normHead(x) === normHead(h));
    if (m.keySource === "column" && m.keyColumn && !has(m.keyColumn)) drifts.push({ what: "the key column is gone", expected: m.keyColumn, observed: t.headers, blocking: true });
    if (m.actions.some((a) => a.type === "delete") && !t.rows.some((r) => r.actions.some((a) => classifyAction(a) === "delete"))) drifts.push({ what: "the delete control is no longer found", expected: m.actions.filter((a) => a.type === "delete").map((a) => a.label), blocking: true });
    const missing = m.columns.filter((c) => !has(c));
    if (missing.length && !drifts.some((d) => d.what === "the key column is gone")) drifts.push({ what: "columns changed", expected: missing, observed: t.headers.filter((h) => !m.columns.some((c) => normHead(c) === normHead(h))), blocking: false });
    this.driftNotes.set(m.id, drifts);
    const blocking = drifts.filter((d) => d.blocking);
    if (blocking.length) throw new CapabilityDrift(m.id, "ui_changed", drifts, `The page no longer matches what was compiled for '${m.id}': ${blocking.map((d) => d.what).join("; ")}.`);
  }

  /** A read-only look: load the list's page, compare with the contract, change nothing. */
  async driftCheck(kind: Kind): Promise<{ ok: boolean; klass?: DriftClass; drifts: DriftItem[]; note?: string }> {
    const m = this.models.get(kind);
    if (!m) throw new Error(`unknown kind ${kind}`);
    const page = this.need();
    try {
      await this.follow(page, { goto: m.url }, m);
      const t = this.pickGrid(await this.rawTables(await this.frameFor(m)), m);
      if (!t) throw await this.driftFor(page, m, [{ what: "the list is no longer on the page", expected: m.columns, blocking: true }]);
      this.checkContract(m, t);
      return { ok: true, drifts: this.driftNotes.get(kind) ?? [] };
    } catch (e) {
      if (e instanceof CapabilityDrift) return { ok: false, klass: e.klass, drifts: e.drifts };
      return { ok: false, klass: "transient", drifts: [{ what: String((e as Error).message).split("\n")[0] ?? "the page did not load", blocking: false }], note: "Could not look at the page. This is not a change to the page; try again." };
    }
  }

  /**
   * Re-learn one list after its page changed, and publish the result only if it still means the same thing.
   * Read-only: it never changes a record. The old compiled model stays in place unless every test passes.
   */
  async repair(kind: Kind): Promise<{ status: "repaired" | "not_repaired"; tests: { name: string; pass: boolean; detail: string }[]; before: TableModel; after?: TableModel }> {
    const old = this.models.get(kind);
    if (!old) throw new Error(`unknown kind ${kind}`);
    const page = this.need();
    const tests: { name: string; pass: boolean; detail: string }[] = [];
    const test = (name: string, pass: boolean, detail: string) => { tests.push({ name, pass, detail }); return pass; };
    const keep = new Map(this.models);
    const goldenRows = this.golden.get(kind) ?? [];
    let candidate: TableModel | undefined;
    try {
      await this.follow(page, { goto: old.url }, old);
      const found = await this.attach(); // re-learns every list on that page
      // the candidate is the new list whose columns and sample values best match the old one
      const score = (c: TableModel) => overlap(c.columns, old.columns) * 2 + (c.title && old.title && normHead(c.title) === normHead(old.title) ? 0.5 : 0);
      candidate = [...found].sort((a, b) => score(b) - score(a))[0];
      if (!test("a matching list exists", !!candidate && score(candidate) >= 0.5, candidate ? `best match '${candidate.id}' with columns ${candidate.columns.join(", ")}` : "no list found")) return { status: "not_repaired", tests, before: old };
    } finally { this.models = keep; }
    const cand: TableModel = { ...candidate!, id: kind };
    // try the candidate in place, then put the old one back unless everything passes
    this.models.set(kind, cand); this.memo.clear();
    let recs: Rec[] = [];
    try {
      test("the key is usable", cand.keySource !== "none", cand.keySource === "none" ? "no unique key on the new list" : `key ${cand.keyColumn ?? "link " + cand.keyParam}`);
      recs = (await this.scanFresh(kind)).recs;
      test("every key is unique across all pages", recs.length > 0 && new Set(recs.map((r) => r.key)).size === recs.length, `${recs.length} records, ${new Set(recs.map((r) => r.key)).size} distinct keys`);
      if (old.actions.some((a) => a.type === "delete")) test("the delete control still means delete", cand.actions.some((a) => a.type === "delete"), `delete found as: ${cand.actions.filter((a) => a.type === "delete").map((a) => a.label).join(", ") || "none"}`);
      if (goldenRows.length) {
        // Same records, same values. Column names may have changed, so compare the VALUES, not the names.
        const matched = goldenRows.filter((g) => { const now = recs.find((r) => r.key === g.key); if (!now) return false; const have = new Set(Object.entries(now).filter(([f]) => f !== "key").map(([, v]) => String(v).trim())); const want = Object.entries(g).filter(([f, v]) => f !== "key" && String(v).trim() !== "").map(([, v]) => String(v).trim()); return want.length === 0 || want.filter((v) => have.has(v)).length / want.length >= 0.7; });
        const need = Math.max(1, Math.ceil(goldenRows.length * 0.7));
        test("previously seen records are still the same records", matched.length >= need, `${matched.length} of ${goldenRows.length} earlier records found with the same key and values (need ${need})`);
      } else test("previously seen records are still the same records", false, "no earlier records were saved for this capability, so its meaning cannot be checked");
    } catch (e) { test("the new list can be read end to end", false, String((e as Error).message).split("\n")[0] ?? "error"); }
    const ok = tests.every((t) => t.pass);
    if (!ok) { this.models.set(kind, old); this.memo.clear(); return { status: "not_repaired", tests, before: old }; }
    this.driftNotes.delete(kind);
    this.golden.set(kind, recs.slice(0, 6).map((r) => ({ ...r })));
    return { status: "repaired", tests, before: old, after: cand };
  }

  /** Every row of a kind. Moves between pages by address, by clicking the pager, or by scrolling. */
  private async scanFresh(kind: Kind, maxPages = 120, stopAt?: string): Promise<{ recs: Rec[]; where: Where[]; partial: boolean }> {
    const m = this.models.get(kind);
    if (!m) throw new Error(`unknown kind ${kind}`);
    const page = this.need();
    const recs: Rec[] = [];
    const where: Where[] = [];
    const route: Hop[] = [];
    let hop: Hop | null = { goto: m.url };
    let lastFirst = "";
    for (let p = 0; hop && p < maxPages; p++) {
      await this.follow(page, hop, m); // the first hop is a fresh load, so earlier state never leaks in
      route.push(hop);
      let frame = await this.frameFor(m);
      let t = this.pickGrid(await this.rawTables(frame), m);
      for (let tries = 0; t && t.rows.length === 0 && m.rows > 0 && tries < 6; tries++) { await page.waitForTimeout(400); t = this.pickGrid(await this.rawTables(frame), m); }
      if (!t) { if (p === 0) throw await this.driftFor(page, m, [{ what: "the list is no longer on the page", expected: m.columns, blocking: true }]); break; }
      if (p === 0) this.checkContract(m, t);
      if (m.scrolls && p === 0) {
        const n = await this.scrollGrowth(frame, t.index, page, m);
        if (n > 0) { route.push({ scroll: n }); frame = await this.frameFor(m); t = this.pickGrid(await this.rawTables(frame), m) ?? t; }
      }
      // The key chosen when the page was compiled stays the key. Recomputing it each time would change it
      // whenever the data does (one empty cell is enough), and every plan made earlier would point at nothing.
      let k: KeyInfo;
      const ci = m.keyColumn ? t.headers.indexOf(m.keyColumn) : -1;
      if (m.keySource === "column" && ci >= 0) k = { column: m.keyColumn, columnIndex: ci, param: null, source: "column" };
      else if (m.keySource === "link" && m.keyParam) k = { column: null, columnIndex: -1, param: m.keyParam, source: "link" };
      else k = findKey(t);
      const cols = dataColumns(t);
      const first = t.rows[0]?.cells.join("|") ?? "";
      if (p > 0 && first === lastFirst) break; // the pager did nothing: stop instead of looping
      lastFirst = first;
      t.rows.forEach((_, ri) => { const r = toRecord(t!, k, ri, cols); if (r) { recs.push(r); where.push({ route: [...route], ri, table: t!, key: k }); } }); // a row with no key value cannot be addressed, so it is left out
      if (stopAt && recs.some((r) => r.key === stopAt)) return { recs, where, partial: true }; // found what was asked for: no need to turn more pages
      hop = t.next && t.next !== frame.url() && t.next !== page.url() ? { goto: t.next } : t.canNext ? { click: true } : null;
    }
    return { recs, where, partial: false };
  }

  /** Wait for a list that renders late: its rows, and its pager, may arrive after the page has gone quiet. */
  private async readyGrid(page: Page, m: TableModel): Promise<RawTable | undefined> {
    let frame = await this.frameFor(m);
    let t = this.pickGrid(await this.rawTables(frame), m);
    for (let tries = 0; tries < 8 && (!t || (t.rows.length === 0 && m.rows > 0)); tries++) {
      await page.waitForTimeout(400);
      frame = await this.frameFor(m);
      t = this.pickGrid(await this.rawTables(frame), m);
    }
    return t;
  }

  private async follow(page: Page, hop: Hop, m: TableModel): Promise<void> {
    if ("goto" in hop) {
      if (hop.goto === m.url || !m.frame) await page.goto(hop.goto, { waitUntil: "load" });
      else await (await this.frameFor(m)).goto(hop.goto, { waitUntil: "load" });
      await this.settle(page);
      await this.readyGrid(page, m);
      return;
    }
    const frame = await this.frameFor(m);
    let t = await this.readyGrid(page, m);
    // the pager is drawn after the rows: if it is not there yet, give it a moment before deciding it is gone
    for (let tries = 0; t && !(await frame.evaluate(nextScript(t.index)).catch(() => false)) && tries < 6 && !("scroll" in hop); tries++) { await page.waitForTimeout(400); t = this.pickGrid(await this.rawTables(frame), m); }
    if (!t) throw new Error("the list is no longer on the page");
    if ("scroll" in hop) {
      for (let i = 0; i < hop.scroll; i++) { await frame.evaluate(scrollScript(t.index)).catch(() => undefined); await this.settle(page, 250, 2500); }
      return;
    }
    if (!(await frame.evaluate(nextScript(t.index)))) throw new Error("the control that shows more rows is gone");
    try { await frame.locator('[data-wicket-target="1"]').first().click(); }
    finally { await frame.evaluate(`document.querySelectorAll("[data-wicket-target]").forEach(function(e){e.removeAttribute("data-wicket-target")})`).catch(() => undefined); }
    await this.settle(page);
  }

  /** Get back to the page a row was found on: load fresh, then repeat the same pager clicks and scrolls. */
  private async replay(page: Page, route: Hop[], m: TableModel): Promise<void> {
    for (const h of route) await this.follow(page, h, m);
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
    const { recs } = await this.scan(kind, real);
    const hit = recs.find((r) => r.key === real) ?? null;
    return hit ? { ...hit, key } : null;
  }

  async counts(forKind?: Kind): Promise<Record<Kind, number>> {
    const out: Record<Kind, number> = {};
    for (const k of forKind ? [forKind] : this.kinds()) {
      if (!this.models.has(k)) continue;
      try { out[k] = (await this.scan(k, undefined, 30_000)).recs.length; } catch (e) { if (e instanceof CapabilityDrift) throw e; /* a page that no longer loads is skipped, not fatal */ }
    }
    return out;
  }

  async exportAll(forKind?: Kind): Promise<Record<Kind, Rec[]>> {
    const out: Record<Kind, Rec[]> = {};
    for (const k of forKind ? [forKind] : this.kinds()) {
      if (!this.models.has(k)) continue;
      try { out[k] = (await this.scan(k)).recs; } catch (e) { if (e instanceof CapabilityDrift) throw e; /* skipped */ }
    }
    return out;
  }

  // ---------- writing ----------

  async delete(kind: Kind, key: string): Promise<void> {
    try { await this.deleteInner(kind, key); } finally { this.memo.clear(); }
  }

  private async deleteInner(kind: Kind, key: string): Promise<void> {
    const m = this.models.get(kind);
    if (!m) throw new Error(`unknown kind ${kind}`);
    const page = this.need();
    const real = this.aliases.get(`${kind}:${key}`) ?? key;
    const { recs, where } = await this.scan(kind);
    const i = recs.findIndex((r) => r.key === real);
    if (i < 0) throw new Error(`${kind} ${key} not found`);
    const w = where[i]!;
    const row = w.table.rows[w.ri]!;
    await this.replay(page, w.route, m);
    this.hookDialogs(page);
    const ai = row.actions.findIndex((a) => classifyAction(a) === "delete");
    if (ai >= 0) {
      await this.pressAndConfirm(page, () => this.stampAndClick(m, w.table.index, w.ri, ai));
      return;
    }
    // No delete on the list. Many apps keep it on the record's own page, so follow the row's link and look there.
    const usable = (a: RawAction) => !!a.href && !/^(javascript:|#)/i.test(a.href);
    const detail = row.actions.find((a) => usable(a) && a.label && row.cells.includes(a.label)) ?? row.actions.find((a) => usable(a) && classifyAction(a) === "view") ?? row.actions.find(usable);
    if (!detail) throw new Error(`no delete action on the row, and no link to the record's own page, for ${kind} ${key}`);
    await page.goto(detail.href, { waitUntil: "load" });
    await this.settle(page);
    const di = (await this.pageActions(page)).findIndex((a) => classifyAction(a) === "delete");
    if (di < 0) throw new Error(`no delete action found on the record's own page for ${kind} ${key}`);
    await this.pressAndConfirm(page, () => this.stampPageAction(page, di));
  }

  /** Press a delete control and answer whatever confirmation follows: a browser dialog, a modal, or a confirm page. Never cancel. */
  private async pressAndConfirm(page: Page, click: () => Promise<void>): Promise<void> {
    const before = page.url();
    const dialogState = TableAdapter.dialogs.get(page);
    if (dialogState) dialogState.expect++;
    try {
      await click();
      await this.settle(page, 250, 3000);
    } finally { if (dialogState) dialogState.expect--; }
    if (await this.confirmModal(page)) {
      await this.settle(page, 250, 3000);
      return;
    }
    if (page.url() !== before) await this.confirmIfAsked(page);
  }

  private async pageActions(page: Page): Promise<RawAction[]> {
    return (await page.mainFrame().evaluate(PAGE_ACTIONS_SCRIPT)) as RawAction[];
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
    for (const frame of page.frames()) {
      const found = await frame.evaluate(MODAL_SCRIPT).catch(() => false);
      if (!found) continue;
      try { await frame.locator('[data-wicket-target="1"]').first().click(); }
      finally { await frame.evaluate(`document.querySelectorAll("[data-wicket-target]").forEach(function(e){e.removeAttribute("data-wicket-target")})`).catch(() => undefined); }
      return true;
    }
    return false;
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
    await this.settle(page, 200, 2500);
  }

  private async stampAndClick(m: TableModel, tableIndex: number, ri: number, ai: number): Promise<void> {
    const frame = await this.frameFor(m);
    const ok = await frame.evaluate(actScript({ t: tableIndex, r: ri, a: ai }));
    if (!ok) throw new Error("could not find the row action on the page");
    try { await frame.locator('[data-wicket-target="1"]').first().click(); }
    finally { await frame.evaluate(`document.querySelectorAll("[data-wicket-target]").forEach(function(e){e.removeAttribute("data-wicket-target")})`).catch(() => undefined); }
  }

  async create(kind: Kind, record: Rec): Promise<void> {
    try { await this.createInner(kind, record); } finally { this.memo.clear(); }
  }

  private async createInner(kind: Kind, record: Rec): Promise<void> {
    const m = this.models.get(kind);
    const page = this.need();
    if (!m) throw new Error(`unknown kind ${kind}`);
    const oldKeys = new Set((await this.scan(kind)).recs.map((r) => r.key)); // a fresh load of the list, and the keys on it
    const frame = await this.frameFor(m);
    const t = this.pickGrid(await this.rawTables(frame), m);
    const add = t ? pickAdd(t.title, t.adds) : null;
    if (!add) throw new Error(`no add button found for ${kind}`);
    await this.follow(page, { goto: m.url }, m); // scanning may have moved to a later page, so start again from the first
    const addFrame = await this.frameFor(m);
    const addLabel = add.label;
    if (add.href && !/^(javascript:|#)/i.test(add.href)) { await page.goto(add.href, { waitUntil: "load" }); }
    else await addFrame.getByRole(/button|submit/i.test(addLabel) ? "button" : "link", { name: addLabel }).first().click().catch(async () => { await addFrame.getByText(addLabel, { exact: false }).first().click(); });
    await this.settle(page, 250, 3000);
    const forms = (await explorePage(page)).forms;
    // The page also has a search box and menus. The form to fill is the one with a submit button and the most fields.
    const f: FormModel | undefined = forms.filter((x) => x.submit && x.fields.length > 0).sort((a, b) => b.fields.length - a.fields.length)[0];
    if (!f || !f.submit) throw new Error("the add page has no form to fill");
    // Match record fields to form fields by name, label, or the column they came from. Never by position.
    const scope = page.locator(f.selector);
    const skipped: string[] = [];
    // Match columns to form fields: by name or label first, then a unique looser match, then by elimination. Never by position.
    const cols = Object.entries(record).filter(([c]) => c !== "key");
    const taken = new Set<string>();
    const assign = new Map<string, FieldModel>();
    for (const [col] of cols) {
      const exact = f.fields.find((x) => !taken.has(x.name) && (norm(x.name) === norm(col) || norm(x.label) === norm(col)));
      const loose = f.fields.filter((x) => !taken.has(x.name) && norm(col).length >= 4 && (norm(x.label).startsWith(norm(col)) || norm(x.label).includes(norm(col))));
      const hit = exact ?? (loose.length === 1 ? loose[0] : undefined);
      if (hit) { assign.set(col, hit); taken.add(hit.name); }
    }
    const textual = ["text", "email", "tel", "url", "textarea", "number", "date"];
    const free = () => f.fields.filter((x) => !taken.has(x.name) && !x.readonly && !x.disabled && textual.includes(x.type));
    const left = () => cols.filter(([c, v]) => !assign.has(c) && c !== m.keyColumn && String(v ?? "") !== "");
    // The column that names the thing the table lists ("Resident" in "Residents") goes to the form's name-like field.
    const entity = norm(m.title).replace(/s$/, "");
    for (const [c] of left()) {
      if (entity && (norm(c) === entity || norm(c) === `${entity}name`)) {
        const named = free().filter((x) => /name|title|label|description/i.test(`${x.name} ${x.label}`));
        if (named.length === 1) { assign.set(c, named[0]!); taken.add(named[0]!.name); }
      }
    }
    // One column and one field are both left over: they belong together.
    const lc = left(), lf = free();
    if (lc.length === 1 && lf.length === 1) assign.set(lc[0]![0], lf[0]!);
    for (const [col] of cols) if (!assign.has(col) && String(record[col] ?? "") !== "" && col !== m.keyColumn) skipped.push(col);
    for (const [col, field] of assign) {
      const raw = record[col];
      const loc = scope.locator(`[name="${field.ref}"]`).first();
      const T = { timeout: 2000 };
      try {
        if (field.type === "select") await loc.selectOption({ label: String(raw) }, T).catch(async () => { await loc.selectOption(String(raw), T); });
        else if (field.type === "checkbox") await loc.setChecked(String(raw).toLowerCase() === "true" || raw === true, T);
        else if (field.type === "radio") await scope.locator(`input[type=radio][name="${field.ref}"][value="${String(raw)}"]`).check(T);
        else await loc.fill(String(raw ?? ""), T);
      } catch { skipped.push(col); } // a value the form has no matching option for is skipped, and reported
    }
    const firstField = [...assign.values()][0];
    await scope.locator(f.submit.selector).first().click();
    await this.settle(page, 250, 3000);
    // Did the app take it? A saved form's fields are gone (a new page, or the panel closes). A refused form keeps them,
    // and usually says why. The address is no signal: many apps post back to the same one.
    const stillThere = firstField ? (await page.locator(`[name="${firstField.ref}"]`).count()) > 0 : false;
    if (stillThere) {
      const msg = await page.evaluate(`(() => { var e = document.querySelectorAll('.error, .errors, .err, .alert-danger, .warning, [role=alert], .ui-state-error, .jnotify-message, [class*=error], [class*=invalid]'); return Array.prototype.map.call(e, function (x) { return (x.innerText || '').replace(/\\s+/g, ' ').trim(); }).filter(Boolean).slice(0, 3).join(' | ').slice(0, 300); })()`) as string;
      throw new Error(`the app did not accept the new record${msg ? `: ${msg}` : ""}${skipped.length ? ` (could not fill: ${skipped.join(", ")})` : ""}`);
    }
    // The new row is the one key that was not there before. If several appeared, match on the values we typed in.
    this.memo.clear(); // the list changed: read it again, not from memory
    const after = (await this.scan(kind)).recs;
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
    this.memo.clear();
    this.aliases.clear();
    this.models.clear();
  }
}

export { assertAuthorized };
