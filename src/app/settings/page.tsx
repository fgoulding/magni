import { Download } from "lucide-react";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { LogoutButton } from "@/components/LogoutButton";
import { SettingsForm } from "@/components/SettingsForm";
import { getSettingNumber, requireUser } from "@/lib/auth";

export default async function SettingsPage() {
  const user = await requireUser().catch(() => null);

  if (!user) {
    redirect("/login");
  }

  const rounding = getSettingNumber(user.id, "rounding", 2.5);

  return (
    <div className="safe-x flex flex-col gap-4 py-5">
      <h1 className="display text-4xl">Settings</h1>
      <section className="card p-4">
        <p className="eyebrow text-[11px] text-faint">Signed in as</p>
        <h2 className="display mt-1 truncate text-xl">{user.email}</h2>
        <div className="mt-5">
          <SettingsForm initialRounding={rounding} />
        </div>
        <div className="mt-6 border-t border-line pt-4">
          <LogoutButton />
        </div>
      </section>

      <details className="card p-4">
        <summary className="display cursor-pointer list-none text-lg">Password</summary>
        <p className="mt-1 text-sm text-muted">
          Change your password. This signs you out of any other devices.
        </p>
        <div className="mt-4">
          <ChangePasswordForm />
        </div>
      </details>

      <details className="card p-4">
        <summary className="display cursor-pointer list-none text-lg">Your data</summary>
        <p className="mt-1 text-sm text-muted">
          Download your full logged history as a CSV spreadsheet — one row per set.
        </p>
        <a
          href="/api/export"
          download
          className="touch-target mt-4 inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-foreground transition-colors active:bg-surface-muted"
        >
          <Download aria-hidden="true" size={16} />
          Export history (CSV)
        </a>
      </details>
    </div>
  );
}
