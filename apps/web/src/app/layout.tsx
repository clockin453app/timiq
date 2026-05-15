import type { Metadata, Viewport } from "next";

import { AppProviders } from "../components/pwa/app-providers";
import "../styles/tokens.css";
import "../styles/globals.css";
import "../styles/typography.css";

export const viewport: Viewport = {
  themeColor: "#eef0f2",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "TimIQ",
  description: "Payroll and workforce management for modern teams.",
  manifest: "/manifest.webmanifest",
  applicationName: "TimIQ",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TimIQ",
  },
  icons: {
    icon: [
      { url: "/icons/timiq-icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icons/timiq-icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/timiq-icon-192.svg", sizes: "180x180", type: "image/svg+xml" }],
  },
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html className="min-h-dvh min-w-0 overflow-x-hidden" lang="en">
      <body className="min-h-dvh min-w-0 overflow-x-hidden antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
