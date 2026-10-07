import { progressApi,progressBody } from "@/features/progress/api";
import { applyExerciseLink,previewExerciseLink,ProgressError,undoExerciseLink } from "@/features/progress/identity";
import type {IdentityChangeInput} from "@/features/progress/types";
export async function POST(request:Request){return progressApi(request,true,async userId=>{
 const input=await progressBody<IdentityChangeInput&{action:string;previewToken:string;requestKey:string;changeId:number}>(request);
 if(input.action==="preview")return previewExerciseLink(userId,input);
 if(input.action==="apply")return applyExerciseLink(userId,input);
 if(input.action==="undo")return undoExerciseLink(userId,input);
 throw new ProgressError(400,"Choose preview, apply or undo.");
});}
