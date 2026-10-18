// The explorer: read a page's forms from the live DOM, read-only. It never clicks submit, never types.
// The output (a PageModel) is all the generator needs. No code here is specific to any one site.
//
// The in-page code is plain JavaScript in a string on purpose. A TypeScript build step can inject helpers
// into a function that are missing inside the browser page, and this must run in any page.

import type { Page } from "playwright-core";

export type FieldType = "text" | "email" | "password" | "number" | "date" | "tel" | "url" | "select" | "radio" | "checkbox" | "textarea" | "file" | "other";

export interface FieldModel {
  /** The key the agent uses: the field's name, or its id when it has no name. */
  name: string;
  ref: string;
  refBy: "name" | "id";
  label: string;
  type: FieldType;
  required: boolean;
  readonly: boolean;
  disabled: boolean;
  options?: { value: string; label: string }[];
  pattern?: string;
  min?: string;
  max?: string;
  maxlength?: number;
  placeholder?: string;
}

export interface FormModel {
  id: string;
  selector: string;
  title: string;
  action: string;
  method: string;
  fields: FieldModel[];
  hiddenFields: string[];
  submit: { label: string; selector: string } | null;
}

export interface PageModel {
  url: string;
  title: string;
  forms: FormModel[];
  warnings: string[];
  /** Controls that send changes somewhere else (Send Data, Sync, Upload), by visible text OR tooltip/accessible name. Seen, never pressed. */
  sendControls?: string[];
}

const EXPLORE_SCRIPT = `(() => {
  var clean = function (s) { return (s == null ? "" : String(s)).replace(/\\s+/g, " ").replace(/[\\s*:]+$/, "").trim(); };
  var textOf = function (n) { return clean(n ? (n.innerText != null ? n.innerText : n.textContent) : ""); };

  var labelFor = function (el) {
    if (el.labels && el.labels.length) return clean(el.labels[0].innerText);
    var aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    var by = el.getAttribute("aria-labelledby");
    if (by) {
      var t = clean(by.split(" ").map(function (id) { var e = document.getElementById(id); return e ? e.innerText : ""; }).join(" "));
      if (t) return t;
    }
    var cell = el.closest("td,th");
    if (cell && cell.previousElementSibling) {
      var ct = textOf(cell.previousElementSibling);
      if (ct) return ct;
    }
    var n = el.previousSibling;
    while (n) {
      var nt = clean(n.textContent);
      if (nt) return nt;
      n = n.previousSibling;
    }
    var ph = el.getAttribute("placeholder");
    if (ph) return clean(ph);
    var title = el.getAttribute("title");
    if (title) return clean(title);
    return el.name || el.id || "";
  };

  var warnings = [];
  if (document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, #cf-challenge-running, [data-sitekey]')) {
    warnings.push("This page has a CAPTCHA or bot challenge. A person must complete it. Wicket will not try to get around it.");
  }

  var forms = [];
  var used = {};
  Array.prototype.forEach.call(document.forms, function (form, i) {
    var fid = form.getAttribute("id"), fname = form.getAttribute("name"); // not form.id: a field named "id" would shadow it
    var selector = fid ? "#" + CSS.escape(fid) : fname ? 'form[name="' + fname + '"]' : "form >> nth=" + i;
    var heading = form.closest("section,fieldset,div");
    var headingEl = heading ? heading.querySelector("h1,h2,h3,legend") : null;
    var title = clean(form.getAttribute("aria-label")) || clean(headingEl ? headingEl.textContent : "") || clean(document.title) || "form " + (i + 1);
    var id = (fid || fname || title || "form" + (i + 1)).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "form" + (i + 1);
    while (used[id]) id += "_x";
    used[id] = true;

    var fields = [], hiddenFields = [], seen = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      var tag = el.tagName.toLowerCase();
      var t = (el.type || "").toLowerCase();
      if (["submit", "button", "reset", "image", "fieldset"].indexOf(t) >= 0 || tag === "button" || tag === "fieldset" || tag === "object" || tag === "output") return;
      var name = el.name || el.id;
      if (!name) return;
      if (t === "hidden") { hiddenFields.push(name); return; }
      if (seen[name]) return;
      seen[name] = true;

      var type = "other";
      if (tag === "select") type = "select";
      else if (tag === "textarea") type = "textarea";
      else if (["text", "email", "password", "number", "date", "tel", "url", "radio", "checkbox", "file"].indexOf(t) >= 0) type = t;
      else if (t === "" || t === "search") type = "text";

      var label = labelFor(el);
      var options;
      var required = el.required === true;
      if (tag === "select") {
        options = Array.prototype.filter.call(el.options, function (o) { return !(o.value === "" && o.disabled); }).map(function (o) { return { value: o.value, label: clean(o.textContent) }; });
      }
      if (type === "radio") {
        var group = Array.prototype.slice.call(form.querySelectorAll('input[type=radio][name="' + CSS.escape(name) + '"]'));
        options = group.map(function (r) {
          var l = r.labels && r.labels[0] ? clean(r.labels[0].innerText) : "";
          var nx = r.nextSibling ? clean(r.nextSibling.textContent) : "";
          return { value: r.value, label: l || nx || r.value };
        });
        required = group.some(function (r) { return r.required; });
        var fs = group[0] ? group[0].closest("fieldset") : null;
        var lg = fs ? fs.querySelector("legend") : null;
        var legend = lg ? clean(lg.textContent) : "";
        if (legend) label = legend;
        else label = name;
      }
      var f = { name: name, ref: name, refBy: el.name ? "name" : "id", label: label || name, type: type, required: required, readonly: el.readOnly === true, disabled: el.disabled === true };
      if (options) f.options = options;
      var pat = el.getAttribute("pattern"); if (pat) f.pattern = pat;
      var mn = el.getAttribute("min"); if (mn) f.min = mn;
      var mx = el.getAttribute("max"); if (mx) f.max = mx;
      var ml = el.getAttribute("maxlength"); if (ml) f.maxlength = Number(ml);
      var ph2 = el.getAttribute("placeholder"); if (ph2) f.placeholder = ph2;
      fields.push(f);
    });

    var describe = function (el) {
      var l = clean(el.value || el.innerText) || "Submit";
      var sel = el.id ? "#" + CSS.escape(el.id) : el.name ? '[name="' + el.name + '"]' : el.tagName.toLowerCase() === "button" ? "button" : "[type=submit]";
      return { label: l, selector: sel };
    };
    // A page can have several submit buttons (a toolbar, a filter, the real Save). Prefer one whose label says it saves.
    var cands = Array.prototype.map.call(form.querySelectorAll('[type=submit], button:not([type])'), describe);
    var good = cands.filter(function (c) { return /(save|add|create|submit|confirm|update|apply|register|ok|yes)/i.test(c.label) && !/(cancel|reset|back|filter)/i.test(c.label); })[0];
    var pick = good || cands[cands.length - 1];
    if (!pick) { var img = form.querySelector("input[type=image]"); if (img) pick = describe(img); }
    var submit = pick ? { label: pick.label, selector: pick.selector } : null;
    forms.push({ id: id, selector: selector, title: title, action: form.getAttribute("action") || "", method: (form.getAttribute("method") || "get").toLowerCase(), fields: fields, hiddenFields: hiddenFields, submit: submit });
  });

  var sendControls = [];
  Array.prototype.slice.call(document.querySelectorAll('input[type=submit], input[type=button], button, a[href], [role=button]')).forEach(function (e) {
    var vis = clean(e.value || e.innerText || ""), tip = clean(e.getAttribute("title") || e.getAttribute("aria-label") || "");
    if (/\\b(send|sync|upload|push|transmit)\\b/i.test(vis + " " + tip)) { var n = vis && tip && vis !== tip ? vis + " (" + tip + ")" : vis || tip; if (sendControls.indexOf(n) < 0) sendControls.push(n); }
  });
  return { url: location.href, title: document.title, forms: forms, warnings: warnings, sendControls: sendControls.slice(0, 5) };
})()`;

export async function explorePage(page: Page): Promise<PageModel> {
  return (await page.evaluate(EXPLORE_SCRIPT)) as PageModel;
}
