// One hosted browser (WICKET_BROWSER_PROVIDER), four retail pages: time, id, price, rating, condition for each.
import { FormAdapter } from "../src/generator/form-adapter.js";
const fa = new FormAdapter();
for (const u of ["https://www.amazon.com/s?k=apple+airpods", "https://www.amazon.com/dp/B0FQFB8FMG", "https://www.bestbuy.com/product/apple-airpods-pro-3-wireless-active-noise-cancelling-earbuds-with-heart-rate-sensing-feature-white/JJGCQLYK5F", "https://www.bestbuy.com/site/searchpage.jsp?st=apple+airpods"]) {
  const t0 = Date.now();
  try {
    const s = (await fa.compile(u)) as { warnings: string[]; items?: { kind: string; count: number; sample: Record<string, unknown>[] }[] };
    const g = s.items?.[0];
    const x = g?.sample[0];
    console.log(((Date.now() - t0) / 1000).toFixed(1) + "s", u.slice(12, 50), g && x ? `${g.kind} ${g.count} ${JSON.stringify({ key: x.key, price: x.price, rating: x.rating, ratings: x.ratings, condition: x.condition })}` : "no items", s.warnings.slice(0, 1));
  } catch (e) { console.log(((Date.now() - t0) / 1000).toFixed(1) + "s", u.slice(12, 50), "ERR", String((e as Error).message).slice(0, 140)); }
}
await fa.close();
