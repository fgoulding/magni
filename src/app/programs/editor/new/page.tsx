import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

export default async function NewEditorPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requireUser().catch(() => redirect("/login"));
  const { from } = await searchParams;
  redirect(`/programs/editor/${crypto.randomUUID()}${from ? `?from=${encodeURIComponent(from)}` : ""}`);
}
