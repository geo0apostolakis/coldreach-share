import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Automatesphere AI Console",
  description: "Cold email campaigns running on Google Sheets",
  icons: { icon: "/automatesphere-logo.png" },
  appleWebApp: { capable: true, title: "Automatesphere", statusBarStyle: "black-translucent" },
};

/**
 * Without this a phone lays the page out at ~980px and scales it down, which
 * makes every control unusably small. viewportFit=cover keeps the layout under
 * the iPhone notch, which the safe-area padding in globals.css then handles.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#12100e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
