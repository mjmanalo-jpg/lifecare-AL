import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Script from "next/script";
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
        {/* Resolve light/dark before first paint so no page flashes the wrong
            theme. Falls back to the OS preference for first-time visitors and
            persists it, keeping every in-app toggle (portal, login, landing)
            reading the same stored value. beforeInteractive injects it into the
            initial HTML, so it runs ahead of hydration without the React
            "script inside component" warning. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';localStorage.setItem('theme',t);}var e=document.documentElement;if(t==='light'){e.classList.add('light');e.style.colorScheme='light';}else{e.classList.remove('light');e.style.colorScheme='dark';}}catch(_){}})();`}
        </Script>
        <SmoothScroll>{children}</SmoothScroll>
        <GlobalToaster />
        <GlobalConfirmDialog />
      </body>
    </html>
  );
}
