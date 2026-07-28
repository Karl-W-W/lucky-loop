import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* Root layout metadata — shared by every page, so this is the product-level
 * description (the War Room sets its own in app/war/page.tsx). It is the OG /
 * search preview for any link to this site: keep it to what the site actually
 * shows. */
export const metadata: Metadata = {
  title: "Lucky Loop",
  description:
    "An agent harness being built in public: an autonomous loop for everyday admin. Objectives, commits and deploys are published on the Lucky Loop War Room.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
