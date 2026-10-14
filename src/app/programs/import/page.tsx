import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ImportJSON } from "@/components/ImportJSON";

export default async function ImportProgramPage() {
  const user = await requireUser().catch(() => redirect("/login"));
  return <div className="safe-x mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5 py-5"><Link href="/programs" className="touch-target inline-flex items-center gap-2 self-start text-sm font-semibold text-muted"><ArrowLeft size={18} aria-hidden="true" />Back to programs</Link><header><h1 className="display text-4xl">Import JSON</h1><p className="mt-2 text-sm text-muted">Your program file, ready to review in Magni.</p></header><ImportJSON userId={user.id} /></div>;
}
