import { Download } from "lucide-react";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { LogoutButton } from "@/components/LogoutButton";
import { SettingsForm } from "@/components/SettingsForm";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getSettingNumber, requireUser } from "@/lib/auth";
import { getSystemStatus } from "@/lib/system-status";
import { userTimeZone } from "@/lib/user-date";

export default async function SettingsPage() {
  const user = await requireUser().catch(() => null);

  if (!user) {
    redirect("/login");
  }

  const system = getSystemStatus();
  const rounding = getSettingNumber(user.id, "rounding", 2.5);

  return (
    <div className="safe-x flex flex-col gap-4 py-5">
      <h1 className="display text-4xl">Settings</h1>
      <section className="card p-4">
        <p className="eyebrow text-[11px] text-faint">Signed in as</p>
        <h2 className="display mt-1 truncate text-xl">{user.email}</h2>
        <div className="mt-5">
          <SettingsForm initialRounding={rounding} initialTimezone={userTimeZone(user.id)} />
        </div>
        <div className="mt-6 border-t border-line pt-4">
          <LogoutButton />
        </div>
      </section>

      <section className="card p-4">
        <p className="eyebrow text-[11px] text-faint">Appearance</p>
        <h2 className="display mt-1 text-lg">Theme</h2>
        <p className="mt-1 text-sm text-muted">Match your device, or force light or dark.</p>
        <div className="mt-3">
          <ThemeToggle />
        </div>
      </section>

      <details className="card p-4"><summary className="touch-target display cursor-pointer text-lg">System status</summary><dl className="mt-3 grid grid-cols-2 gap-2 text-sm"><dt className="text-muted">Database</dt><dd>{system.databaseReady ? "Ready" : "Unavailable"}</dd><dt className="text-muted">Storage used</dt><dd>{system.databaseBytes === null ? "Unavailable" : `${(system.databaseBytes / 1_048_576).toFixed(1)} MB`}</dd><dt className="text-muted">Free disk space</dt><dd>{system.freeBytes === null ? "Unavailable" : `${(system.freeBytes / 1_073_741_824).toFixed(1)} GB`}</dd><dt className="text-muted">Last verified backup</dt><dd className={system.backup?.stale ? "text-warn-ink" : ""}>{system.backup ? `${system.backup.completedAt.slice(0,10)}${system.backup.stale ? " · Over 48 hours old" : ""}` : "No verified backup receipt"}</dd><dt className="text-muted">Version</dt><dd className="break-all">{system.version} · {system.revision === "local-unreleased" ? "Local changes" : system.revision.slice(0,12)}</dd></dl><p className="mt-3 text-sm leading-6 text-muted">Failed saves remain visible on the workout or draft until retried. Deployment logs record server write failures. Backup status confirms a verified snapshot reached host storage; keep an off-device copy too.</p></details>
      <details className="card p-4">
        <summary className="touch-target display cursor-pointer list-none text-lg">Password</summary>
        <p className="mt-1 text-sm text-muted">
          Change your password. This signs you out of any other devices.
        </p>
        <div className="mt-4">
          <ChangePasswordForm />
        </div>
      </details>

      <details className="card p-4">
        <summary className="touch-target display cursor-pointer list-none text-lg">Your data</summary>
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
