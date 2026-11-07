import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Life is a Banana: The Cosmic Slip",
  description: "La vie est une banane — a comedic synthwave physics arcade runner. Tumble down the Highway of Life, dodge the Giant Blender of Fate, and charge up Super Yellow Mode.",
  keywords: ["game", "three.js", "banana", "arcade", "runner", "synthwave", "physics"],
  authors: [{ name: "The Cosmic Slip Team" }],
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M7 24 Q13 29 23 14' stroke='%23FFE135' stroke-width='7' fill='none' stroke-linecap='round'/%3E%3C/svg%3E",
  },
  openGraph: {
    title: "Life is a Banana: The Cosmic Slip",
    description: "La vie est une banane — roll, slip and tumble down the neon Highway of Life.",
    siteName: "The Cosmic Slip",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
