import type { ReactNode } from "react";

import { PublicSiteShell } from "../../components/public/public-site-shell";

type PublicLayoutProps = {
  children: ReactNode;
};

export default function PublicLayout({ children }: PublicLayoutProps) {
  return <PublicSiteShell variant="marketing">{children}</PublicSiteShell>;
}
