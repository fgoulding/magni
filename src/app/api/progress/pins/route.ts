import { progressApi,progressBody,progressFilters } from "@/features/progress/api";
import { updateExercisePin } from "@/features/progress/identity";
import { getProgressHome } from "@/features/progress/queries";
export async function GET(request:Request){return progressApi(request,false,userId=>getProgressHome(userId,progressFilters(request)));}
export async function POST(request:Request){return progressApi(request,true,async userId=>{
 const input=await progressBody<Parameters<typeof updateExercisePin>[1]>(request);updateExercisePin(userId,input);return getProgressHome(userId,progressFilters(request));
});}
