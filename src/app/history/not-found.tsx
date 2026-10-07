import { ProgressBack } from "@/components/progress/ProgressChrome";
export default function ProgressNotFound() { return <div className="safe-x flex flex-col gap-4 py-5"><h1 className="display text-3xl">Exercise not found</h1><p className="text-muted">Find the recorded name or return to your overview.</p><ProgressBack href="/history/exercises">Find an exercise</ProgressBack></div>; }
