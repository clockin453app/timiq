import { AppShell } from "../../components/layout";
import { AuthGuard } from "../../features/auth";
import { ProfileClient } from "./profile-client";

export default function ProfilePage() {
  return (
    <AuthGuard>
      <AppShell activeHref="/profile">
        <ProfileClient />
      </AppShell>
    </AuthGuard>
  );
}
