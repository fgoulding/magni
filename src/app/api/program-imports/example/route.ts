import { PROGRAM_FILE_EXAMPLE } from "@/features/program-files/example";
export function GET() { return Response.json(PROGRAM_FILE_EXAMPLE,{headers:{"Content-Disposition":'attachment; filename="example.magni.json"'}}); }
