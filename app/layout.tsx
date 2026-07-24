import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Codex Reset Tracker",
  description: "Community-maintained history of reported Codex quota resets.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
