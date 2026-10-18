// One browser, one thing at a time. Agents call tools in parallel; a page can only be in one place.
// Everything that drives the browser takes this lock. A call made from inside a call that already holds it (the same async chain)
// goes straight through, so nothing waits on itself.
import { AsyncLocalStorage } from "node:async_hooks";

let tail: Promise<unknown> = Promise.resolve();
const held = new AsyncLocalStorage<boolean>();

export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (held.getStore()) return fn();
  const next = tail.then(() => held.run(true, fn), () => held.run(true, fn));
  tail = next.catch(() => undefined);
  return next;
}

/** Wrap the named methods of an object so each one takes the lock. */
export function serialize(target: object, names: readonly string[]): void {
  for (const name of names) {
    const original = (target as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
    if (typeof original !== "function") continue;
    const bound = original.bind(target);
    (target as Record<string, unknown>)[name] = (...a: unknown[]) => exclusive(() => bound(...a));
  }
}
