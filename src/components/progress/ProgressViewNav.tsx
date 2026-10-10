import Link from "next/link";

export function ProgressViewNav({ currentHref, view }: { currentHref: string; view: "exercise" | "big-three" }) {
  function href(next: string) {
    const url = new URL(currentHref, "https://magni.invalid");
    url.searchParams.set("view", next);
    return url.pathname + url.search;
  }
  return <nav aria-label="Progress views" className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface-muted p-1">
    {([{ value: "exercise", label: "One exercise" }, { value: "big-three", label: "Big three" }] as const).map(item => <Link key={item.value} href={href(item.value)} aria-current={view === item.value ? "page" : undefined} className={`touch-target flex min-w-0 flex-[1_1_8rem] items-center justify-center rounded-lg px-3 py-2 text-center text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${view === item.value ? "bg-surface text-brand-strong shadow-sm" : "text-muted"}`}>{item.label}</Link>)}
  </nav>;
}
