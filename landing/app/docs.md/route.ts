//created by kinjal
import { docsMarkdown } from "@/lib/docs";

// The docs as one markdown file, for agents. Same content as /docs.
export function GET() {
  return new Response(docsMarkdown(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
