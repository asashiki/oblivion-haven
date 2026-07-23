import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gal Blog Game Studio",
  description: "AI-first Galgame authoring, orchestration and WebGAL compilation for gal-blog.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
