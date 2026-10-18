import { FormAdapter } from "../src/generator/form-adapter.js";
const fa = new FormAdapter();
for (const u of ["https://www.amazon.com/dp/B0FQFB8FMG", "https://www.amazon.com/dp/B0DGHMNQ5Z", "https://www.amazon.com/dp/B0GSS4SGZR"]) {
  const t0 = Date.now();
  const s = await fa.compile(u);
  const it = (s as any).items?.[0]?.sample?.[0];
  console.log(((Date.now() - t0) / 1000).toFixed(1) + "s", it ? JSON.stringify({ key: it.key, price: it.price, rating: it.rating, ratings: it.ratings, condition: it.condition }) : "no item");
}
await fa.close();
