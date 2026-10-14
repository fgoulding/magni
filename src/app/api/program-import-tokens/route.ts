import { createImportToken, listImportTokens } from "@/features/program-imports/repository";
import { importFailure, importSession, privateJson, readImportBody } from "@/features/program-imports/http";
export async function GET(request: Request) {
  try { const user = await importSession(request); return privateJson({tokens:listImportTokens(user.id)}); }
  catch (error) { return importFailure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await importSession(request,true);
    const body = await readImportBody(request,["name","expiresInDays"],4096);
    return privateJson(createImportToken(user.id,{name:body.name,expiresInDays:body.expiresInDays}),201);
  } catch (error) { return importFailure(error); }
}
