import { pageMarkdown } from "@/lib/markdown";

export function GET() {
  return new Response(pageMarkdown(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
