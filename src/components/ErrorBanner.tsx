"use client";

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="rounded-xl border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm leading-5 text-danger-ink"
    >
      {message}
    </div>
  );
}
