import { PROGRAM_FILE_SCHEMA } from "@/features/program-files/schema";
export function GET() { return Response.json(PROGRAM_FILE_SCHEMA); }
