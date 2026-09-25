import { Injectable, NotFoundException } from "@nestjs/common";
import type { DetectedOpportunityCandidate } from "@developer-brand-copilot/contracts";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";
import { fingerprintPhase3OpportunityInput, type CanonicalPhase3OpportunityInput } from "./phase3-opportunity-input";
import { OpportunityDecision, phase3OpportunityScoringVersion, scorePhase3OpportunityCandidates } from "./phase3-opportunity-scoring";
import { Phase3OpportunityInputSelectorService } from "./phase3-opportunity-input-selector.service";

export interface PersistScoredOpportunitiesRequest {
 readonly userId:string; readonly projectId:string; readonly aiExecutionId:string; readonly task33InputFingerprint:string;
 readonly input:CanonicalPhase3OpportunityInput;
 readonly task34:{readonly extractionVersion:string;readonly detectorVersion:string;readonly modelConfigurationFingerprint:string;readonly promptVersion:string;readonly schemaVersion:string};
}
export interface PersistScoredOpportunitiesResult { readonly decisions:readonly OpportunityDecision[]; readonly reusedOpportunityIds:readonly string[]; readonly createdOpportunityIds:readonly string[]; }
export type ContentOpportunityScoringFailureCode = "OPPORTUNITY_INPUT_STALE" | "OPPORTUNITY_DETECTION_RESULT_INVALID" | "OPPORTUNITY_SCORING_INVARIANT_FAILED";
export class ContentOpportunityScoringError extends Error {
 constructor(readonly failureCode:ContentOpportunityScoringFailureCode,message:string,cause?:unknown){super(message,{cause});this.name="ContentOpportunityScoringError";}
}
@Injectable()
export class ContentOpportunityScoringService {
 constructor(private readonly prisma:PrismaService,private readonly inputSelector:Phase3OpportunityInputSelectorService){}
 async scoreAndPersist(request:PersistScoredOpportunitiesRequest):Promise<PersistScoredOpportunitiesResult>{
  if(request.projectId!==request.input.projectId||fingerprintPhase3OpportunityInput(request.input)!==request.task33InputFingerprint)throw new ContentOpportunityScoringError("OPPORTUNITY_INPUT_STALE","Stale or mismatched Task 3.3 input");
  const current=await this.inputSelector.select(request.userId,request.projectId,new Date(request.input.evaluationBoundary));
  if(current.inputFingerprint!==request.task33InputFingerprint)throw new ContentOpportunityScoringError("OPPORTUNITY_INPUT_STALE","Task 3.3 input is no longer current");
  return this.prisma.$transaction(async tx=>{
   const project=await tx.project.findFirst({where:{id:request.projectId,userId:request.userId},select:{id:true,timezone:true}});
   if(!project)throw new NotFoundException("Project not found");if(project.timezone!==request.input.timezone)throw new ContentOpportunityScoringError("OPPORTUNITY_INPUT_STALE","Stale project timezone");
   await tx.$queryRawUnsafe('SELECT "id" FROM "Project" WHERE "id" = $1::uuid FOR UPDATE',request.projectId);
   const execution=await tx.aIExecution.findFirst({
    where:{
     id:request.aiExecutionId,projectId:request.projectId,stage:"opportunity_detection",status:"succeeded",validationStatus:"valid",
     inputFingerprint:request.task33InputFingerprint,extractionVersion:request.task34.extractionVersion,
     modelConfigurationFingerprint:request.task34.modelConfigurationFingerprint,promptVersion:request.task34.promptVersion,schemaVersion:request.task34.schemaVersion,
    },
    include:{opportunityDetectionResult:{include:{candidates:{
     orderBy:{position:"asc"},include:{developmentEvents:{orderBy:{position:"asc"}}},
    }}}},
   });
   const result=execution?.opportunityDetectionResult;
   if(!execution||!result||result.projectId!==request.projectId||result.inputFingerprint!==request.task33InputFingerprint||result.candidateCount!==result.candidates.length||result.candidateCount<0)throw new ContentOpportunityScoringError("OPPORTUNITY_DETECTION_RESULT_INVALID","Validated Task 3.4 result missing or incomplete");
   const supplied=new Set(request.input.developmentEvents.map(e=>e.developmentEventId)),candidates:DetectedOpportunityCandidate[]=[];
   for(let i=0;i<result.candidates.length;i++){
    const row=result.candidates[i]!;if(row.position!==i||row.selectedEventCount!==row.developmentEvents.length||row.selectedEventCount<1)throw new ContentOpportunityScoringError("OPPORTUNITY_DETECTION_RESULT_INVALID","Incomplete persisted detector candidate");
    const ids:string[]=[];for(let j=0;j<row.developmentEvents.length;j++){const link=row.developmentEvents[j]!;if(link.position!==j||!supplied.has(link.developmentEventId))throw new ContentOpportunityScoringError("OPPORTUNITY_DETECTION_RESULT_INVALID","Detector provenance does not match Task 3.3 input");ids.push(link.developmentEventId);}
    candidates.push({eventIds:ids,opportunityType:row.opportunityType,title:row.title,recommendedFormat:row.recommendedFormat,topicDescriptor:row.topicDescriptor,confidence:row.confidence});
   }
   if(!candidates.length){
    await tx.contentOpportunity.updateMany({where:{projectId:request.projectId,isCurrent:true,scoringVersion:{startsWith:"phase3-opportunity-scoring-"}},data:{isCurrent:false,status:"expired",expiredAt:new Date()}});
    return {decisions:[],reusedOpportunityIds:[],createdOpportunityIds:[]};
   }
   let decisions:readonly OpportunityDecision[];
   try{decisions=scorePhase3OpportunityCandidates(request.input,candidates,{resultId:result.id,extractionVersion:request.task34.extractionVersion,detectorVersion:request.task34.detectorVersion,modelConfigurationFingerprint:request.task34.modelConfigurationFingerprint},request.task33InputFingerprint);}
   catch(error){throw new ContentOpportunityScoringError("OPPORTUNITY_SCORING_INVARIANT_FAILED","Task 3.5 scoring invariant failed",error);}
   const createdOpportunityIds:string[]=[],reusedOpportunityIds:string[]=[];
   for(const d of decisions){
    const where={projectId_candidateKey_inputFingerprint_scoringVersion:{projectId:request.projectId,candidateKey:d.candidateKey,inputFingerprint:d.inputFingerprint,scoringVersion:phase3OpportunityScoringVersion}};
    const old=await tx.contentOpportunity.findUnique({where,select:{id:true,isCurrent:true,shouldPost:true,status:true,inputFingerprint:true,scoringVersion:true,topicKey:true,title:true,opportunityType:true,recommendedFormat:true,priorityScore:true,noveltyScore:true,confidence:true,developmentEvents:{select:{developmentEventId:true}},reasonSignals:{select:{code:true,effect:true,value:true,position:true,developmentEvents:{select:{developmentEventId:true}}}}}});
    if(old){
     const ids=old.developmentEvents.map(x=>x.developmentEventId).sort();
     const reasonsOk=old.reasonSignals.length===d.reasons.length&&old.reasonSignals.every((r,i)=>{const e=d.reasons[i];return !!e&&r.code===e.code&&r.effect===e.effect&&r.position===i&&(r.value===null?e.value===null:Number(r.value.toString())===e.value)&&r.developmentEvents.map(x=>x.developmentEventId).sort().join("|")===[...e.developmentEventIds].sort().join("|");});
     if(!old.isCurrent||old.inputFingerprint!==d.inputFingerprint||old.scoringVersion!==d.scoringVersion||old.topicKey!==d.topicKey||old.title!==d.title||
      old.opportunityType!==d.opportunityType||old.recommendedFormat!==d.recommendedFormat||old.shouldPost!==d.shouldPost||old.status!==d.status||
      Number(old.priorityScore.toString())!==d.priorityScore||Number(old.noveltyScore.toString())!==d.noveltyScore||Number(old.confidence.toString())!==d.confidence||
      ids.join("|")!==[...d.developmentEventIds].sort().join("|")||!reasonsOk)throw new ContentOpportunityScoringError("OPPORTUNITY_SCORING_INVARIANT_FAILED","Existing opportunity identity is incomplete or inconsistent");
     reusedOpportunityIds.push(old.id);continue;
    }
    await tx.contentOpportunity.updateMany({where:{projectId:request.projectId,candidateKey:d.candidateKey,isCurrent:true},data:{isCurrent:false,status:"expired",expiredAt:new Date()}});
    const row=await tx.contentOpportunity.create({data:{
     projectId:request.projectId,candidateKey:d.candidateKey,inputFingerprint:d.inputFingerprint,opportunityType:d.opportunityType,topicKey:d.topicKey,title:d.title,recommendedFormat:d.recommendedFormat,
     priorityScore:new Prisma.Decimal(d.priorityScore.toFixed(3)),noveltyScore:new Prisma.Decimal(d.noveltyScore.toFixed(3)),shouldPost:d.shouldPost,confidence:new Prisma.Decimal(d.confidence.toFixed(3)),status:d.status,scoringVersion:d.scoringVersion,isCurrent:true,
     developmentEvents:{create:d.developmentEventIds.map(developmentEventId=>({developmentEventId}))},
     reasonSignals:{create:d.reasons.map((r,position)=>({code:r.code,effect:r.effect,value:r.value===null?null:new Prisma.Decimal(r.value.toFixed(3)),position,developmentEvents:{create:r.developmentEventIds.map(developmentEventId=>({developmentEventId}))}}))},
    },select:{id:true}});
    createdOpportunityIds.push(row.id);
   }
   return {decisions,reusedOpportunityIds,createdOpportunityIds};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 }
}
