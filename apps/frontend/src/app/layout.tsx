import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";
import { GlobalToaster } from "@/components/ui/global-toast";
import { GlobalConfirmDialog } from "@/components/ui/global-confirm";

const inter = Inter({ subsets: ["latin"] });

const SITE_URL = "https://assisted-living.resoluteaiph.com";
const SITE_TITLE = "Senior Living Management System (SLMS) | Real-time Assisted Living Management";
const SITE_DESC = "Next-Generation Senior Living Management System (SLMS) Person-Centered Care Platform";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESC,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-icon.png",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Senior Living Management System (SLMS)",
    title: SITE_TITLE,
    description: SITE_DESC,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESC,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-background text-foreground`} suppressHydrationWarning>
        <SmoothScroll>{children}</SmoothScroll>
        <GlobalToaster />
        <GlobalConfirmDialog />
      </body>
    </html>
  );
}
