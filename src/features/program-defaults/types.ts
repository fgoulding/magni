import type { SharedProgramSnapshot } from "@/features/shared-programs/types";

export type ProgramDefault = Readonly<{
  id: string;
  label: string;
  description: string;
  snapshot: SharedProgramSnapshot;
}>;
