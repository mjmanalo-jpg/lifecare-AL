"use client";

import ResidentRegistration from "@/components/portal/views/ResidentRegistration";

export default function RegisterPage() {
  // Public, pre-auth resident self-registration. The wizard opens immediately;
  // its close/X and successful submit both route back to /login.
  return (
    <main className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-amber-950/30">
      <ResidentRegistration variant="public" />
    </main>
  );
}
