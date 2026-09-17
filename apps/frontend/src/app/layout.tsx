import type { Metadata, Viewport } from "next";
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
const OG_IMAGE = "/sanctuary_exterior.png"; // ponytail: real facility photo; swap a 1200×630 render when one exists

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESC,
  manifest: "/manifest.json",
  // Positive default for the public marketing surface. Authenticated portals are
  // fenced off in robots.ts (crawlers never fetch them to read this anyway).
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  // Set NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION to the token from Search Console's
  // HTML-tag method, or skip this and use DNS verification for a Domain property.
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } }
    : {}),
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
    images: [{ url: OG_IMAGE, alt: "LifeCare senior living residence" }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [OG_IMAGE],
  },
};

// Site-wide structured data. Organization.logo is what lets Google show the
// brand logo; alternateName covers the aliases people actually search for
// (SLMS, LifeCare, the full product name) so any branded query resolves here.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Senior Living Management System (SLMS)",
      alternateName: ["SLMS", "LifeCare", "ResoluteAI"],
      url: SITE_URL,
      logo: `${SITE_URL}/icon-512.png`,
      description: SITE_DESC,
      address: {
        "@type": "PostalAddress",
        addressLocality: "Pasig City",
        addressRegion: "Metro Manila",
        addressCountry: "PH",
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_TITLE,
      alternateName: ["SLMS", "LifeCare"],
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

/* `viewportFit: "cover"` is what makes `env(safe-area-inset-*)` resolve to real
   values on notched iPhones. Without it those insets are 0, so the mobile dock's
   safe-area padding silently does nothing and the dock sits under the home
   indicator once the app is installed to the Home Screen. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-background text-foreground`} suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
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
