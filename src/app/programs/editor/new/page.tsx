import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { PRESETS } from "@/features/program-editor/operations";

export default async function NewEditorPage({ searchParams }: { searchParams: Promise<{ from?: string; preset?: string }> }) {
  await requireUser().catch(() => redirect("/login"));
  const { from, preset } = await searchParams;
  const query = new URLSearchParams();
  if (from) query.set("from", from);
  else if (PRESETS.some(item => item.id === preset)) query.set("preset", preset!);
  redirect(`/programs/editor/${crypto.randomUUID()}${query.size ? `?${query}` : ""}`);
}
