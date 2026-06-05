import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LiftDetailContent } from "@/components/LiftDetailContent";
import { getUserLiftDetail } from "@/features/programs/training-stats";
import { requireUser } from "@/lib/auth";

type PageProps = { params: Promise<{ lift: string }> };

export default async function LiftDetailPage({ params }: PageProps) {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const { lift } = await params;
  const name = decodeURIComponent(lift);
  const detail = getUserLiftDetail(user.id, name);

  return (
    <div className="safe-x flex flex-col gap-4 py-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow text-[11px] text-brand-strong">Main lift</p>
          <h1 className="display truncate text-4xl">{detail.name}</h1>
        </div>
        <Link
          href="/history"
          aria-label="Back to stats"
          className="touch-target inline-flex shrink-0 items-center justify-center gap-1 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-muted transition-colors active:bg-surface-muted"
        >
          <ChevronLeft aria-hidden="true" size={16} />
          Stats
        </Link>
      </header>

      <LiftDetailContent detail={detail} />
    </div>
  );
}
