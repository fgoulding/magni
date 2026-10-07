import { progressApi,progressFilters } from "@/features/progress/api";
import { ProgressError } from "@/features/progress/identity";
import { getExerciseCandidates,getExerciseDetail,listProgressExercises,listUnlinkedExercises } from "@/features/progress/queries";
export async function GET(request:Request){return progressApi(request,false,userId=>{
  const p=new URL(request.url).searchParams;const filters=progressFilters(request);const group=p.get("group");const id=p.get("exerciseId");
  if(group)return listUnlinkedExercises(userId,group,filters);
  if(id&&p.get("candidates")==="1")return getExerciseCandidates(userId,id,filters);
  if(id){const detail=getExerciseDetail(userId,id,filters);if(!detail)throw new ProgressError(404,"Exercise not found.");return detail;}
  return listProgressExercises(userId,filters);
});}
