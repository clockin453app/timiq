import type { Metadata } from "next";

import "../styles/tokens.css";
import "../styles/globals.css";
import "../styles/typography.css";

export const metadata: Metadata = {
  title: "TimIQ",
  description: "Payroll and workforce management for modern teams.",
};

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="min-h-dvh min-w-0 overflow-x-clip antialiased">{children}</body>
    </html>
  );
}