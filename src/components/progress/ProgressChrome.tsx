import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { pageLinks } from "./navigation";

export const progressButton = "touch-target inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-base font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
export const progressInput = "touch-target w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function ProgressTabs({ active }: { active: "overview" | "history" }) {
  return <nav aria-label="Progress sections" className="flex gap-1 self-start rounded-xl border border-line bg-surface-muted p-1">
    {[{ value: "overview", href: "/history", name: "Overview" }, { value: "history", href: "/workouts", name: "History" }].map(tab => <Link key={tab.value} href={tab.href} aria-current={active === tab.value ? "page" : undefined} className={`touch-target inline-flex items-center justify-center rounded-lg px-5 py-2 text-base font-semibold ${active === tab.value ? "bg-surface text-brand-strong shadow-sm" : "text-muted"}`}>{tab.name}</Link>)}
  </nav>;
}

export function ProgressBack({ href, children = "Back to Progress" }: { href: string; children?: React.ReactNode }) {
  return <Link href={href} className={`${progressButton} self-start`}><ArrowLeft aria-hidden="true" size={16} />{children}</Link>;
}

export function ProgressPagination({ currentHref, nextCursor, previousCursor, count, noun = "results" }: { currentHref: string; nextCursor: string | null; previousCursor?: string | null; count: number; noun?: string }) {
  const links = pageLinks(currentHref, nextCursor, previousCursor);
  return <div className="flex flex-col gap-2">
    <p role="status" className="text-sm text-muted">{count} {noun} shown</p>
    {(links.previous || links.next) && <nav aria-label="Result pages" className="flex flex-wrap justify-between gap-2">
      {links.previous ? <Link href={links.previous} className={progressButton}><ArrowLeft aria-hidden="true" size={16} />Previous</Link> : <span />}
      {links.next && <Link href={links.next} className={progressButton}>Next<ArrowRight aria-hidden="true" size={16} /></Link>}
    </nav>}
  </div>;
}

export function ProgressDate({ date, short = false }: { date: string; short?: boolean }) {
  return <time dateTime={date} title={date}>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(short ? {} : { year: "numeric" as const }), timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}</time>;
}
