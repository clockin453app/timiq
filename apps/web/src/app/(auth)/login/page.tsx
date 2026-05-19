"use client";

import { Suspense } from "react";

import { LoginForm } from "../../../components/public/login-form";
import {
  LoginBenefitsGrid,
  LoginPageFooter,
  LoginPageIntro,
} from "../../../components/public/login-marketing-panel";
import { PublicDemoCta } from "../../../components/public/public-demo-cta";
import { PublicSiteShell } from "../../../components/public/public-site-shell";
import { uiClasses } from "../../../lib/ui-classes";

function LoginPageContent() {
  return (
    <PublicSiteShell activePath="/login" variant="login">
      <div className={uiClasses.publicMain}>
        <div className={uiClasses.publicLoginGrid}>
          <LoginPageIntro className={uiClasses.publicLoginIntroSlot} />
          <div className={uiClasses.publicLoginFormSlot}>
            <LoginForm />
          </div>
          <PublicDemoCta className={uiClasses.publicLoginDemoSlot} />
          <LoginBenefitsGrid className={uiClasses.publicLoginBenefitsSlot} />
          <LoginPageFooter className={uiClasses.publicLoginFooterSlot} />
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
