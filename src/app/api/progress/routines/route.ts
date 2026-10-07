import { progressApi,progressFilters } from "@/features/progress/api";
import { listProgressRoutines } from "@/features/progress/queries";
export async function GET(request:Request){return progressApi(request,false,userId=>listProgressRoutines(userId,progressFilters(request)));}
