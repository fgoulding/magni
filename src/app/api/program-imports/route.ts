import { enforceAuthRateLimit } from "@/lib/rate-limit";
import { importProgram } from "@/features/program-imports/repository";
import { importFailure, importPrincipal, privateJson, readImportBody } from "@/features/program-imports/http";
export async function POST(request: Request) {
  const limited = enforceAuthRateLimit(request,"program-import",{limit:60,windowMs:60_000}); if (limited) return limited;
  try {
    const principal = await importPrincipal(request);
    const body = await readImportBody(request,["requestKey","file"]);
    const result = importProgram({...principal,requestKey:body.requestKey,file:body.file});
    return privateJson(result,result.replayed ? 200 : 201);
  } catch (error) { return importFailure(error); }
}
