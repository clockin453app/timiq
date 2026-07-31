import type { Metadata, Viewport } from "next";

import { AppProviders } from "../components/pwa/app-providers";
import "../styles/tokens.css";
import "../styles/globals.css";
import "../styles/typography.css";

export const viewport: Viewport = {
  themeColor: "#192F60",
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
      { url: "/branding/timiq-favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/branding/timiq-favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: [{ url: "/branding/timiq-favicon-32.png" }],
    apple: [{ url: "/branding/timiq-app-192.png", sizes: "192x192", type: "image/png" }],
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
