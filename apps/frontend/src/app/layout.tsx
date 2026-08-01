import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";
import { GlobalToaster } from "@/components/ui/global-toast";
import { GlobalConfirmDialog } from "@/components/ui/global-confirm";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LifeCare CMS (LCMS) | Real-time Assisted Living Management",
  description: "Next-Generation LifeCare CMS (LCMS) Person-Centered Care Platform",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-icon.png",
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
