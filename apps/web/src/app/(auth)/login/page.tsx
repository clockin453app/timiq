"use client";

import { Suspense } from "react";

import { LoginForm } from "../../../components/public/login-form";
import { LoginMarketingPanel } from "../../../components/public/login-marketing-panel";
import { PublicSiteShell } from "../../../components/public/public-site-shell";
import { uiClasses } from "../../../lib/ui-classes";

function LoginPageContent() {
  return (
    <PublicSiteShell activePath="/login" variant="login">
      <div className={uiClasses.publicMain}>
        <div className={uiClasses.publicLoginGrid}>
          <LoginMarketingPanel />
          <div className="w-full min-w-0 lg:pt-1">
            <LoginForm />
          </div>
        </div>
      </div>
    </PublicSiteShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
