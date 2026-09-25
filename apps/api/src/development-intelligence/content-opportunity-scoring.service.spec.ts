import { describe, expect, it, vi } from "vitest";
import { ContentOpportunityScoringService } from "./content-opportunity-scoring.service";
import { fingerprintPhase3OpportunityInput, phase3OpportunityInputSelectionVersion, type CanonicalPhase3OpportunityInput } from "./phase3-opportunity-input";
import type { PrismaService } from "../database/prisma.service";
import type { Phase3OpportunityInputSelectorService } from "./phase3-opportunity-input-selector.service";
import type { DetectedOpportunityCandidate } from "@developer-brand-copilot/contracts";
import { scorePhase3OpportunityCandidates } from "./phase3-opportunity-scoring";

const userId="owner",projectId="project";
const input:CanonicalPhase3OpportunityInput={
 selectionVersion:phase3OpportunityInputSelectionVersion,projectId,timezone:"UTC",evaluationBoundary:"2026-01-01T12:00:00.000Z",developerDay:"2026-01-01",
 projectState:null,developmentEvents:[],opportunityHistory:[],
 truncation:{developmentEvents:false,opportunityHistory:false,activeFeatures:false,completedFeatures:false,recentMilestones:false,projectTechnologies:false,stateTextFields:0},
};
function setup(result:unknown,selected:CanonicalPhase3OpportunityInput=input,existing:unknown=null){
 const tx={
  project:{findFirst:vi.fn().mockResolvedValue({id:projectId,timezone:"UTC"})},
  $queryRawUnsafe:vi.fn().mockResolvedValue([]),
  aIExecution:{findFirst:vi.fn().mockResolvedValue({id:"execution",opportunityDetectionResult:result})},
  contentOpportunity:{updateMany:vi.fn().mockResolvedValue({count:0}),findUnique:vi.fn().mockResolvedValue(existing),create:vi.fn().mockResolvedValue({id:"created"})},
 };
 const prisma={$transaction:vi.fn(async(callback:(value:typeof tx)=>unknown)=>callback(tx))};
 const selector={select:vi.fn().mockResolvedValue({input:selected,inputFingerprint:fingerprintPhase3OpportunityInput(selected)})};
 const service=new ContentOpportunityScoringService(prisma as unknown as PrismaService,selector as unknown as Phase3OpportunityInputSelectorService);
 return {service,tx,prisma,selector};
}
const request=(selected:CanonicalPhase3OpportunityInput=input)=>({userId,projectId,aiExecutionId:"execution",task33InputFingerprint:fingerprintPhase3OpportunityInput(selected),input:selected,task34:{extractionVersion:"extract-v1",detectorVersion:"detector-v1",modelConfigurationFingerprint:"a".repeat(64),promptVersion:"prompt-v1",schemaVersion:"schema-v1"}});
const candidate:DetectedOpportunityCandidate={eventIds:["event-1"],opportunityType:"release",title:"Release update",recommendedFormat:"release_announcement",topicDescriptor:"Current Release",confidence:.9};
const populatedInput:CanonicalPhase3OpportunityInput={...input,developmentEvents:[{developmentEventId:"event-1",eventKey:"event-1",inputFingerprint:"c".repeat(64),extractionVersion:"event-v1",type:"release",status:"active",title:"Release",summary:"Release",importanceScore:.9,contentPotentialScore:.9,confidence:.9,occurredAt:input.evaluationBoundary,technologies:[],relatedFeatureIds:["feature-1"],supportingEvidenceKinds:[],truncated:{title:false,summary:false,technologies:false,relatedFeatureIds:false}}]};
function persistedResult(selected:CanonicalPhase3OpportunityInput){return {id:"result",projectId,inputFingerprint:fingerprintPhase3OpportunityInput(selected),candidateCount:1,candidates:[{position:0,opportunityType:candidate.opportunityType,title:candidate.title,recommendedFormat:candidate.recommendedFormat,topicDescriptor:candidate.topicDescriptor,confidence:candidate.confidence,selectedEventCount:1,developmentEvents:[{position:0,developmentEventId:"event-1"}]}]};}
describe("ContentOpportunityScoringService persistence boundary",()=>{
 it("validates owner, current canonical input, and a complete zero-candidate result without creating rows",async()=>{
  const result={id:"result",projectId,inputFingerprint:fingerprintPhase3OpportunityInput(input),candidateCount:0,candidates:[]};
  const {service,tx,selector}=setup(result);
  await expect(service.scoreAndPersist(request())).resolves.toEqual({decisions:[],reusedOpportunityIds:[],createdOpportunityIds:[]});
  expect(selector.select).toHaveBeenCalledWith(userId,projectId,new Date(input.evaluationBoundary));
  expect(tx.project.findFirst).toHaveBeenCalledWith({where:{id:projectId,userId},select:{id:true,timezone:true}});
  expect(tx.contentOpportunity.create).not.toHaveBeenCalled();
  expect(tx.contentOpportunity.updateMany).toHaveBeenCalledWith({where:{projectId,isCurrent:true,scoringVersion:{startsWith:"phase3-opportunity-scoring-"}},data:{isCurrent:false,status:"expired",expiredAt:expect.any(Date)}});
 });
 it("fails closed when a matching execution has no complete persisted result",async()=>{
  const {service,tx}=setup(null);
  await expect(service.scoreAndPersist(request())).rejects.toThrow("Validated Task 3.4 result missing or incomplete");
  expect(tx.contentOpportunity.create).not.toHaveBeenCalled();
 });
 it("rejects an input no longer selected as authoritative before starting persistence",async()=>{
  const {service,prisma,selector}=setup(null);
  selector.select.mockResolvedValueOnce({input,inputFingerprint:"f".repeat(64)});
  await expect(service.scoreAndPersist(request())).rejects.toThrow("Task 3.3 input is no longer current");
  expect(prisma.$transaction).not.toHaveBeenCalled();
 });
 it("creates a recommended row with event provenance and ordered structured reasons atomically",async()=>{
  const {service,tx,prisma}=setup(persistedResult(populatedInput),populatedInput);
  const result=await service.scoreAndPersist(request(populatedInput));
  expect(result.createdOpportunityIds).toEqual(["created"]);
  expect(tx.contentOpportunity.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({candidateKey:result.decisions[0]!.candidateKey,isCurrent:true})}));
  const create=tx.contentOpportunity.create.mock.calls[0]![0] as {data:Record<string,unknown>};
  expect(create.data.status).toBe("recommended");expect(create.data.shouldPost).toBe(true);
  expect(create.data.developmentEvents).toEqual({create:[{developmentEventId:"event-1"}]});
  expect(create.data.reasonSignals).toEqual({create:expect.arrayContaining([expect.objectContaining({code:"release_or_milestone"})])});
  expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:expect.any(String)});
 });
 it("reuses an exact complete current decision without writing or expiring",async()=>{
  const fp=fingerprintPhase3OpportunityInput(populatedInput),candidates=[candidate],task34={resultId:"result",extractionVersion:"extract-v1",detectorVersion:"detector-v1",modelConfigurationFingerprint:"a".repeat(64)};
  const decision=scorePhase3OpportunityCandidates(populatedInput,candidates,task34,fp)[0]!;
  const existing={id:"existing",isCurrent:true,shouldPost:decision.shouldPost,status:decision.status,inputFingerprint:decision.inputFingerprint,scoringVersion:decision.scoringVersion,topicKey:decision.topicKey,title:decision.title,opportunityType:decision.opportunityType,recommendedFormat:decision.recommendedFormat,priorityScore:decision.priorityScore.toFixed(3),noveltyScore:decision.noveltyScore.toFixed(3),confidence:decision.confidence.toFixed(3),developmentEvents:decision.developmentEventIds.map(developmentEventId=>({developmentEventId})),reasonSignals:decision.reasons.map((r,position)=>({code:r.code,effect:r.effect,value:r.value===null?null:r.value.toFixed(3),position,developmentEvents:r.developmentEventIds.map(developmentEventId=>({developmentEventId}))}))};
  const {service,tx}=setup(persistedResult(populatedInput),populatedInput,existing);
  const result=await service.scoreAndPersist(request(populatedInput));
  expect(result.reusedOpportunityIds).toEqual(["existing"]);expect(result.createdOpportunityIds).toEqual([]);
  expect(tx.contentOpportunity.create).not.toHaveBeenCalled();expect(tx.contentOpportunity.updateMany).not.toHaveBeenCalled();
 });
});
