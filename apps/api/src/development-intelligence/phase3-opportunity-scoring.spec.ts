import { describe, expect, it } from "vitest";
import { getPhase3DevelopmentScenarios, scorePhase3DevelopmentEvaluation, type Phase3EvaluationObservation, type Phase3OpportunityScenario } from "@developer-brand-copilot/ai";
import type { DetectedOpportunityCandidate } from "@developer-brand-copilot/contracts";
import { phase3OpportunityInputSelectionVersion, type CanonicalPhase3OpportunityInput } from "./phase3-opportunity-input";
import { opportunityCandidateKey, normalizeOpportunityTopic, phase3CandidateIdentityVersion, phase3OpportunityScoringVersion, scorePhase3OpportunityCandidates } from "./phase3-opportunity-scoring";

const task34={resultId:"result-1",extractionVersion:"extract-v1",detectorVersion:"detector-v1",modelConfigurationFingerprint:"a".repeat(64)},fingerprint="b".repeat(64);
function makeInput(s:Phase3OpportunityScenario):CanonicalPhase3OpportunityInput {
 return {
  selectionVersion:phase3OpportunityInputSelectionVersion,projectId:s.input.projectId,timezone:s.input.timezone,
  evaluationBoundary:s.input.developerDay+"T12:00:00.000Z",developerDay:s.input.developerDay,projectState:null,
  developmentEvents:s.input.events.map(e=>({developmentEventId:e.id,eventKey:e.id,inputFingerprint:fingerprint,extractionVersion:"event-v1",type:e.type,status:"active",title:e.title,summary:e.summary,importanceScore:e.importanceScore,contentPotentialScore:e.contentPotentialScore,confidence:e.confidence,occurredAt:e.occurredAt,technologies:[],relatedFeatureIds:e.relatedFeatureIds,supportingEvidenceKinds:[],truncated:{title:false,summary:false,technologies:false,relatedFeatureIds:false}})),
  opportunityHistory:s.input.recentContentOpportunities.map(h=>({opportunityId:h.id,candidateKey:h.id,inputFingerprint:fingerprint,scoringVersion:phase3OpportunityScoringVersion,topicKey:h.topicKey,opportunityType:h.type,status:h.status,shouldPost:h.shouldPost,isCurrent:h.status!=="expired",createdAt:h.createdDeveloperDay+"T12:00:00.000Z",createdDeveloperDay:h.createdDeveloperDay,expiredAt:h.status==="expired"?h.createdDeveloperDay+"T12:00:00.000Z":null,linkedDevelopmentEvents:h.relatedFeatureIds.flatMap(id=>s.input.events.filter(e=>e.relatedFeatureIds.includes(id)).map(e=>({developmentEventId:e.id,type:e.type}))),linkedFeatureIds:h.relatedFeatureIds,truncatedLinkedEvents:false,truncatedLinkedFeatureIds:false})),
  truncation:{developmentEvents:false,opportunityHistory:false,activeFeatures:false,completedFeatures:false,recentMilestones:false,projectTechnologies:false,stateTextFields:0},
 };
}
function detectorCandidate(s:Phase3OpportunityScenario):DetectedOpportunityCandidate|null {
 const e=s.expected;if(!e.opportunityExpected||!e.topicKey||!e.opportunityType||!e.recommendedFormat)return null;
 return {eventIds:[...e.linkedDevelopmentEventIds],opportunityType:e.opportunityType,title:"Synthetic validated title",recommendedFormat:e.recommendedFormat,topicDescriptor:e.topicKey,confidence:Math.min(...e.linkedDevelopmentEventIds.map(id=>s.input.events.find(event=>event.id===id)?.confidence??0))};
}
function observe(s:Phase3OpportunityScenario):Phase3EvaluationObservation {
 const c=detectorCandidate(s);if(!c)return {scenarioId:s.id,duplicateSuppressed:null,linkedDevelopmentEventIds:[],noveltyScore:null,opportunityType:null,reasonSignalCodes:[],recommendedFormat:null,releaseMilestoneExceptionApplied:null,shouldPost:null,status:null,topicKey:null};
 const d=scorePhase3OpportunityCandidates(makeInput(s),[c],task34,fingerprint)[0]!;
 return {scenarioId:s.id,duplicateSuppressed:d.duplicateSuppressed,linkedDevelopmentEventIds:d.developmentEventIds,noveltyScore:d.noveltyScore,opportunityType:d.opportunityType,reasonSignalCodes:d.reasons.map(r=>r.code),recommendedFormat:d.recommendedFormat,releaseMilestoneExceptionApplied:d.releaseMilestoneExceptionApplied,shouldPost:d.shouldPost,status:d.status,topicKey:d.topicKey};
}
describe("Task 3.5 deterministic opportunity scoring",()=>{
 it("normalizes Unicode topics and makes candidate identity order-independent",()=>{
  expect(normalizeOpportunityTopic("  \uFF23af\u00e9 / BUILD  ")).toBe("caf\u00e9-build");
  expect(opportunityCandidateKey(["b","a"],"release","topic")).toBe(opportunityCandidateKey(["a","b"],"release","topic"));
  expect(opportunityCandidateKey(["a"],"release","topic")).not.toBe(opportunityCandidateKey(["a"],"milestone","topic"));
  expect(opportunityCandidateKey(["a"],"release","topic")).not.toBe(opportunityCandidateKey(["a"],"release","topic-2"));
  expect(normalizeOpportunityTopic("authentication architecture")).not.toBe(normalizeOpportunityTopic("OAuth login"));
  expect(phase3CandidateIdentityVersion).toBe("phase3-opportunity-candidate-v1");
  expect(()=>normalizeOpportunityTopic("...")).toThrow();
  expect(()=>normalizeOpportunityTopic("a".repeat(161))).toThrow();
  expect(normalizeOpportunityTopic(normalizeOpportunityTopic("Caf\u00e9 BUILD"))).toBe("caf\u00e9-build");
 });
 it("returns no decisions for a persisted successful zero-candidate detector result",()=>{
  expect(scorePhase3OpportunityCandidates(makeInput(getPhase3DevelopmentScenarios()[0]!),[],task34,fingerprint)).toEqual([]);
 });
 it("keeps exact duplicate suppression separate from the grounded novelty exception",()=>{
  const scenario=getPhase3DevelopmentScenarios().find(s=>s.input.events.length>0)!;
  const base=makeInput(scenario),source=base.developmentEvents[0]!;
  const input:CanonicalPhase3OpportunityInput={...base,developmentEvents:[{...source,type:"release",confidence:.9,importanceScore:.9,contentPotentialScore:.9,occurredAt:base.evaluationBoundary}],opportunityHistory:[]};
  const candidate:DetectedOpportunityCandidate={eventIds:[source.developmentEventId],opportunityType:"release",title:"Release",recommendedFormat:"release_announcement",topicDescriptor:"Current Release",confidence:.9};
  const duplicate={opportunityId:"prior",candidateKey:"prior",inputFingerprint:fingerprint,scoringVersion:phase3OpportunityScoringVersion,topicKey:"current-release",opportunityType:"release" as const,status:"recommended" as const,shouldPost:true,isCurrent:true,createdAt:input.developerDay+"T12:00:00.000Z",createdDeveloperDay:input.developerDay,expiredAt:null,linkedDevelopmentEvents:[],linkedFeatureIds:[],truncatedLinkedEvents:false,truncatedLinkedFeatureIds:false};
  const exact=scorePhase3OpportunityCandidates({...input,opportunityHistory:[duplicate]},[candidate],task34,fingerprint)[0]!;
  expect(exact.duplicateSuppressed).toBe(true);expect(exact.releaseMilestoneExceptionApplied).toBe(true);expect(exact.shouldPost).toBe(false);
  const suppressed={...duplicate,status:"suppressed" as const};
  const exception=scorePhase3OpportunityCandidates({...input,opportunityHistory:[suppressed]},[candidate],task34,fingerprint)[0]!;
  expect(exception.duplicateSuppressed).toBe(false);expect(exception.releaseMilestoneExceptionApplied).toBe(true);expect(exception.shouldPost).toBe(true);
 });
 it("withholds below 0.60 final confidence and allows exactly 0.60 through that boundary",()=>{
  const scenarios=getPhase3DevelopmentScenarios();
  const low=scenarios.find(s=>s.expected.opportunityExpected&&s.input.events.some(e=>e.confidence===.59))!;
  const lowCandidate=detectorCandidate(low)!;
  const lowDecision=scorePhase3OpportunityCandidates(makeInput(low),[lowCandidate],task34,fingerprint)[0]!;
  expect(lowDecision.confidence).toBe(.59);expect(lowDecision.shouldPost).toBe(false);expect(lowDecision.reasons.map(r=>r.code)).toContain("low_confidence");
  const boundary=scenarios.find(s=>s.expected.opportunityExpected&&s.input.events.some(e=>e.confidence===.6))!;
  const boundaryDecision=scorePhase3OpportunityCandidates(makeInput(boundary),[detectorCandidate(boundary)!],task34,fingerprint)[0]!;
  expect(boundaryDecision.confidence).toBe(.6);expect(boundaryDecision.reasons.map(r=>r.code)).not.toContain("low_confidence");
 });
 it("fails closed for missing provenance and same-run candidate collisions",()=>{
  const s=getPhase3DevelopmentScenarios().find(x=>x.expected.opportunityExpected)!;const c=detectorCandidate(s)!;
  expect(()=>scorePhase3OpportunityCandidates(makeInput(s),[{...c,eventIds:["not-selected"]}],task34,fingerprint)).toThrow(/provenance/);
  expect(()=>scorePhase3OpportunityCandidates(makeInput(s),[c,{...c,title:"different title"}],task34,fingerprint)).toThrow(/collision/);
 });
 it("evaluates only the frozen DEV split",()=>{
  const report=scorePhase3DevelopmentEvaluation(getPhase3DevelopmentScenarios().map(observe));
  expect(report.scenarioCount).toBe(80);expect(report.heldOut).toBe(false);
  expect(report.precisionGateSatisfied).toBe(true);
  expect(report.visiblePrecision).not.toBeNull();expect(report.opportunityTypeAccuracy).not.toBeNull();
  expect(report.duplicateSuppressionAccuracy).not.toBeNull();expect(report.provenanceAccuracy).toBe(1);
 });
});
