"use client";

import Link from "next/link";
import { progressButton } from "@/components/progress/ProgressChrome";

export default function ProgressError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <div className="safe-x flex flex-col gap-4 py-5"><h1 className="display text-3xl">Progress could not load</h1><p role="alert" className="text-muted">Your search and filters are still in the address. Retry to load the same results.</p><div className="flex flex-wrap gap-2"><button type="button" className={progressButton} onClick={retry}>Retry</button><Link href="/history" className={progressButton}>Back to Progress</Link></div></div>;
}
