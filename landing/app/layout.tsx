import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { site, copy } from "@/lib/site";
import "./globals.css";

const sans = Geist({ variable: "--f-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--f-mono", subsets: ["latin"] });
const newsreader = Newsreader({ variable: "--f-newsreader", subsets: ["latin"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  // Set NEXT_PUBLIC_SITE_URL to the production domain so share cards resolve to absolute URLs.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3111"),
  title: `${site.name}: ${copy.h1}`,
  description: copy.heroSub(site.name),
  openGraph: { title: `${site.name}: ${copy.h1}`, description: copy.heroSub(site.name), siteName: site.name, type: "website" },
  twitter: { card: "summary_large_image", title: `${site.name}: ${copy.h1}`, description: copy.heroSub(site.name) },
  alternates: { types: { "text/markdown": "/index.md" } },
  robots: { index: false },
};

export const viewport: Viewport = { themeColor: "#1426e6" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} ${newsreader.variable} antialiased`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        {children}
      </body>
    </html>
  );
}
