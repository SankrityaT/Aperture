// Item cards: search results and product grids are not tables. They are repeated blocks that each carry an id attribute
// (data-asin, data-sku-id, data-product-id, ...). Each block becomes a read-only record: its id is the key, and the fields are
// the ones a person reads off a card: name, price, rating, number of ratings, link. Reading only; nothing on a card is pressed.
import type { Page } from "playwright-core";

export type CardRow = { key: string; title: string; price: string | null; rating: string | null; ratings: string | null; url: string | null; sku?: string; note?: string };
export type CardGroup = { attr: string; rows: CardRow[] };

export async function readCards(page: Page): Promise<CardGroup[]> {
  // A string, so the bundler cannot rewrite the function that runs inside the page.
  return page.evaluate(`(() => {
    var idAttr = /^data-(asin|sku|sku-?id|product-?id|item-?id|pid|listing-?id|offer-?id)$/i;
    var groups = {};
    var all = document.querySelectorAll("*");
    for (var i = 0; i < all.length && i < 60000; i++) {
      var el = all[i];
      for (var j = 0; j < el.attributes.length; j++) {
        var a = el.attributes[j];
        if (idAttr.test(a.name) && a.value && a.value.length >= 3 && a.value.length <= 40 && /^[A-Za-z0-9_-]+$/.test(a.value)) (groups[a.name] = groups[a.name] || []).push(el);
      }
    }
    var txt = function (e) { return ((e && (e.innerText || e.textContent)) || "").replace(/\\s+/g, " ").trim(); };
    var labels = function (e) { var s = []; e.querySelectorAll("[aria-label],[title]").forEach(function (x) { s.push(x.getAttribute("aria-label") || x.getAttribute("title")); }); return s.join(" | "); };
    var out = [];
    Object.keys(groups).forEach(function (attr) {
      var els = groups[attr].filter(function (e) {
        var v = e.getAttribute(attr); var up = e.parentElement && e.parentElement.closest("[" + attr + "=\\"" + v + "\\"]");
        return !up && e.querySelector("a[href]") && txt(e).length > 15;
      });
      var seen = {}; var rows = [];
      els.forEach(function (e) {
        var key = e.getAttribute(attr); if (seen[key] || rows.length >= 80) return; seen[key] = 1;
        var t = txt(e); var lab = labels(e); var both = t + " | " + lab;
        var head = e.querySelector("h2, h3, h4, [data-cy*=title], [class*=title] a, [class*=Title] a");
        var title = head ? txt(head) : "";
        if (!title) e.querySelectorAll("a[href]").forEach(function (x) { var s = txt(x); if (s.length > title.length) title = s; });
        var priceEl = Array.prototype.find.call(e.querySelectorAll(".a-price .a-offscreen, [class*=price] , [data-testid*=price]"), function (x) { return /\\$\\s?\\d/.test(x.textContent || ""); });
        var pm = ((priceEl && priceEl.textContent) || t).match(/\\$\\s?\\d[\\d,]*(\\.\\d{2})?/);
        var rm = both.match(/(\\d(?:\\.\\d)?) out of 5/i) || both.match(/rating[^\\d]{0,12}(\\d\\.\\d)/i);
        var cm = both.match(/([\\d,]+(?:\\.\\d+)?K?)\\s*(?:global\\s+)?(?:ratings|reviews)/i) || both.match(/out of 5[^(]{0,40}\\(([\\d,.]+K?)\\)/i);
        var link = Array.prototype.find.call(e.querySelectorAll("a[href]"), function (x) { var h = x.getAttribute("href") || ""; return h && h[0] !== "#" && !/^javascript:/i.test(h); });
        var url = null; if (link) { try { var u = new URL(link.getAttribute("href"), location.href); url = u.origin + u.pathname; } catch (err) {} }
        var sku = (both.match(/SKU:?\\s*(\\d{6,9})/i) || [])[1] || ((e.querySelector("[data-sku-id]") || { getAttribute: function () { return null; } }).getAttribute("data-sku-id")) || undefined;
        var note = /\\b(renewed|refurbished|pre-owned|open-box|used)\\b/i.exec(title) ? "listed as " + RegExp.$1.toLowerCase() : (/^sponsored\\b|\\bsponsored\\b/i.test(t.slice(0, 80)) ? "sponsored" : undefined);
        var row = { key: key, title: title.slice(0, 200), price: pm ? pm[0].replace(/\\s/g, "") : null, rating: rm ? rm[1] : null, ratings: cm ? cm[1] : null, url: url };
        if (sku && sku !== key) row.sku = sku; if (note) row.note = note;
        rows.push(row);
      });
      if (rows.length >= 3) out.push({ attr: attr, rows: rows });
    });
    return out.sort(function (a, b) { return b.rows.length - a.rows.length; }).slice(0, 2);
  })()`) as Promise<CardGroup[]>;
}

/** A readable kind name for a site's cards: amazon_items, bestbuy_items. */
export function cardKind(url: string, i: number): string {
  let h = "site"; try { const parts = new URL(url).hostname.replace(/^www\./, "").split("."); h = (parts.length > 1 ? parts[parts.length - 2] : parts[0]) ?? "site"; } catch { /* keep default */ }
  return `${h.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_items${i ? `_${i + 1}` : ""}`;
}

export type ProductRow = CardRow & { source: "product page"; availability?: string | null; condition?: string | null };

/** One product page: the shop's own structured data (schema.org Product, what it publishes for search engines), else the
 *  common page elements. Returns null when the page is not a single product. */
export async function readProduct(page: Page): Promise<ProductRow | null> {
  return page.evaluate(`(() => {
    var t = function (sel) { var e = document.querySelector(sel); return e ? (e.innerText || e.textContent || "").replace(/\\s+/g, " ").trim() : ""; };
    var p = null;
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
      try {
        var j = JSON.parse(s.textContent || "null"); var list = Array.isArray(j) ? j : (j && j["@graph"]) ? j["@graph"] : [j];
        list.forEach(function (x) { var ty = x && x["@type"]; if (!p && (ty === "Product" || (Array.isArray(ty) && ty.indexOf("Product") >= 0))) p = x; });
      } catch (e) {}
    });
    var url = location.origin + location.pathname;
    var asin = (location.pathname.match(/\\/(?:dp|gp\\/product)\\/([A-Z0-9]{10})/) || [])[1] || (document.querySelector("input#ASIN") || {}).value;
    var skuUrl = (location.pathname.match(/\\/sku\\/(\\d{6,9})/) || location.search.match(/skuId=(\\d{6,9})/) || [])[1];
    if (p) {
      var o = p.offers; if (Array.isArray(o)) o = o[0]; if (o && o.offers) o = Array.isArray(o.offers) ? o.offers[0] : o.offers;
      var ar = p.aggregateRating || {};
      var key = String(p.sku || skuUrl || asin || p.productID || p.mpn || "");
      if (!key) return null;
      var price = o && (o.price || o.lowPrice); var cur = (o && o.priceCurrency) || "USD";
      return { key: key, title: String(p.name || "").slice(0, 200), price: price ? (cur === "USD" ? "$" : cur + " ") + Number(price).toFixed(2) : null,
        rating: ar.ratingValue ? String(ar.ratingValue) : null, ratings: ar.reviewCount || ar.ratingCount ? String(ar.reviewCount || ar.ratingCount) : null, url: url,
        availability: o && o.availability ? String(o.availability).replace(/^https?:\\/\\/schema\\.org\\//, "") : null,
        condition: o && o.itemCondition ? String(o.itemCondition).replace(/^https?:\\/\\/schema\\.org\\//, "") : null, source: "product page" };
    }
    if (asin) {
      var pr = (t("#corePrice_feature_div .a-offscreen") || t("#corePriceDisplay_desktop_feature_div .a-offscreen") || t("#apex_desktop .a-offscreen") || t(".a-price .a-offscreen")).match(/\\$\\s?\\d[\\d,]*(\\.\\d{2})?/);
      var rt = ((document.querySelector("#acrPopover") || {}).title || t("#acrPopover")).match(/(\\d(?:\\.\\d)?) out of 5/);
      var ct = t("#acrCustomerReviewText").match(/([\\d,]+)/);
      var av = t("#availability"); var bb = t("#desktop_buybox") || t("#buybox") || t("#rightCol");
      var used = /used|renewed/i.test(t("#productTitle")) ? "listed as used or renewed" : (/(^|\s)(Used|Renewed)\b|Used - |Pre-owned/.test(bb.slice(0, 600)) ? "the buy box shows a used or renewed offer; the new-unit price may differ" : null);
      return { key: asin, title: t("#productTitle").slice(0, 200), price: pr ? pr[0].replace(/\\s/g, "") : null, rating: rt ? rt[1] : null, ratings: ct ? ct[1] : null, url: location.origin + "/dp/" + asin,
        availability: av || null, condition: used, source: "product page" };
    }
    return null;
  })()`) as Promise<ProductRow | null>;
}
