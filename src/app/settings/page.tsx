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
    </div>
  );
}
