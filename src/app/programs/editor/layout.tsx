export default function ProgramEditorLayout({ children }: { children: React.ReactNode }) {
  return <div data-program-workspace className="flex min-w-0 flex-1 flex-col">{children}</div>;
}
