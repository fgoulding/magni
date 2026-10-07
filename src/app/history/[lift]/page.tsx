import { redirect } from "next/navigation";

/** Legacy names lead to discovery; a shared label never establishes exercise identity. */
export default async function LegacyLiftPage({ params }: { params: Promise<{ lift: string }> }) {
  const { lift } = await params;
  let name = lift;
  try { name = decodeURIComponent(lift); } catch { /* A literal percent remains searchable. */ }
  redirect(`/history/exercises?q=${encodeURIComponent(name)}`);
}
