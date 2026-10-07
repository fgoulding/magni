import { progressApi,progressFilters } from "@/features/progress/api";
import { listProgressPrograms } from "@/features/progress/queries";
export async function GET(request:Request){return progressApi(request,false,userId=>listProgressPrograms(userId,progressFilters(request)));}
