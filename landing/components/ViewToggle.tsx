import Link from "next/link";

// Human | Agent: the same site as a page, or as the markdown an agent reads. Two real links, no client state.
export function ViewToggle({ current, tone = "blue" }: { current: "human" | "agent"; tone?: "blue" | "light" }) {
  const wrap = tone === "blue" ? "border-white/25 bg-white/10" : "border-[#1426e6]/20 bg-[#f4f5fb]";
  const on = tone === "blue" ? "bg-white text-[#1426e6]" : "bg-[#1426e6] text-white";
  const off = tone === "blue" ? "text-[#f2f0ff]/85 hover:text-white" : "text-[#5c6288] hover:text-[#0b1240]";
  const item = (key: "human" | "agent", label: string, href: string) => (
    <Link
      href={href}
      aria-current={current === key ? "page" : undefined}
      className={`rounded-full px-3.5 py-1.5 text-[0.9rem] font-medium transition ${current === key ? on : off}`}
    >
      {label}
    </Link>
  );
  return (
    <div role="group" aria-label="View" className={`inline-flex items-center gap-0.5 rounded-full border p-0.5 ${wrap}`}>
      {item("human", "Human", "/")}
      {item("agent", "Agent", "/agent")}
    </div>
  );
}
