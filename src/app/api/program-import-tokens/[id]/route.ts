import { revokeImportToken } from "@/features/program-imports/repository";
import { importFailure, importSession } from "@/features/program-imports/http";
export async function DELETE(request: Request, context: {params:Promise<{id:string}>}) {
  try {
    const user = await importSession(request,true); const {id} = await context.params;
    revokeImportToken(user.id,id);
    return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
  } catch (error) { return importFailure(error); }
}
