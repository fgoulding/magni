import { progressApi,progressFilters } from "@/features/progress/api";
import { getProgressHistory } from "@/features/progress/queries";
export async function GET(request:Request){return progressApi(request,false,userId=>getProgressHistory(userId,{...progressFilters(request),status:new URL(request.url).searchParams.get("status") as "all"|"completed"|"in_progress"|"skipped"??undefined}));}
