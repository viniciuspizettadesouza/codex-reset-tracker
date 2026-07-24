import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Codex Reset Tracker — when Codex quotas reset early",
  description:
    "OpenAI Codex sometimes resets usage limits ahead of schedule. An independent log of when it actually happens — so you know the moment your quota is back.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.className}>
      <body>{children}</body>
    </html>
  );
}
