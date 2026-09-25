import { createHash } from "node:crypto";
import type { ContentOpportunityReasonCode, ContentOpportunityReasonEffect, ContentOpportunityStatus, DetectedOpportunityCandidate } from "@developer-brand-copilot/contracts";
import type { CanonicalPhase3OpportunityInput } from "./phase3-opportunity-input";
import { developerDayWindow } from "./developer-day";

export const phase3TopicNormalizationVersion = "phase3-topic-normalization-v1";
export const phase3CandidateIdentityVersion = "phase3-opportunity-candidate-v1";
export const phase3OpportunityScoringVersion = "phase3-opportunity-scoring-v1";
export const phase3OpportunityThresholds = Object.freeze({ confidence: 0.6, novelty: 0.35, priority: 0.6 });
export interface ScoredOpportunityReason { readonly code: ContentOpportunityReasonCode; readonly effect: ContentOpportunityReasonEffect; readonly value: number | null; readonly developmentEventIds: readonly string[]; }
export interface OpportunityDecision {
 readonly candidateKey:string; readonly inputFingerprint:string; readonly opportunityType:DetectedOpportunityCandidate["opportunityType"];
 readonly topicKey:string; readonly title:string; readonly recommendedFormat:DetectedOpportunityCandidate["recommendedFormat"];
 readonly priorityScore:number; readonly noveltyScore:number; readonly confidence:number; readonly shouldPost:boolean;
 readonly status:Exclude<ContentOpportunityStatus,"expired">; readonly scoringVersion:string; readonly isCurrent:true;
 readonly developmentEventIds:readonly string[]; readonly reasons:readonly ScoredOpportunityReason[];
 readonly duplicateSuppressed:boolean; readonly releaseMilestoneExceptionApplied:boolean;
}
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0, round=(n:number)=>Math.round(Math.max(0,Math.min(1,n))*1000)/1000, day=86400000;
function json(v:unknown):string { if(v===null||typeof v!=="object")return JSON.stringify(v); if(Array.isArray(v))return "["+v.map(json).join(",")+"]"; const o=v as Record<string,unknown>;return "{"+Object.keys(o).sort(cmp).map(k=>JSON.stringify(k)+":"+json(o[k])).join(",")+"}"; }
const hash=(v:unknown)=>createHash("sha256").update(json(v),"utf8").digest("hex");
export function normalizeOpportunityTopic(value:string):string { const key=value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu,"-").replace(/^-+|-+$/g,""); if(!key||[...key].length>160)throw new Error("Invalid topic descriptor"); return key; }
export function opportunityCandidateKey(eventIds:readonly string[],type:string,topicKey:string):string { return hash({version:phase3CandidateIdentityVersion,eventIds:[...new Set(eventIds)].sort(cmp),type,topicKey}); }
function ageDay(dayText:string,today:string):number|null { const a=Date.parse(dayText+"T00:00:00Z"),b=Date.parse(today+"T00:00:00Z");return Number.isFinite(a)&&Number.isFinite(b)?Math.floor((b-a)/day):null; }
function freshness(age:number):number { return age===0?1:age<=2?.85:age<=7?.6:age<=14?.3:0; }
export function scorePhase3OpportunityCandidates(input:CanonicalPhase3OpportunityInput,candidates:readonly DetectedOpportunityCandidate[],task34:{readonly resultId:string;readonly extractionVersion:string;readonly detectorVersion:string;readonly modelConfigurationFingerprint:string},task33InputFingerprint:string):readonly OpportunityDecision[] {
 if(!candidates.length)return [];
 if(!input.projectId||!/[a-f0-9]{64}/i.test(task33InputFingerprint)||!task34.resultId||!task34.extractionVersion||!task34.detectorVersion||!task34.modelConfigurationFingerprint)throw new Error("Incomplete authoritative Task 3.4 identity");
 const events=new Map(input.developmentEvents.map(e=>[e.developmentEventId,e]));if(events.size!==input.developmentEvents.length)throw new Error("Duplicate event identity");
 const seen=new Set<string>(),out:OpportunityDecision[]=[];
 for(const c of candidates){
  const ids=[...c.eventIds].sort(cmp);if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!events.has(id))||!Number.isFinite(c.confidence)||c.confidence<0||c.confidence>1)throw new Error("Invalid candidate provenance/confidence");
  const linked=ids.map(id=>events.get(id)!),topicKey=normalizeOpportunityTopic(c.topicDescriptor),candidateKey=opportunityCandidateKey(ids,c.opportunityType,topicKey);
  if(seen.has(candidateKey))throw new Error("Candidate identity collision");seen.add(candidateKey);
  const history=input.opportunityHistory.filter(h=>{const age=ageDay(h.createdDeveloperDay,input.developerDay);return age!==null&&age>=0&&age<30&&h.status!=="expired";});
  const exact=history.filter(h=>h.topicKey===topicKey&&h.opportunityType===c.opportunityType);
  // Release/milestone exceptions bypass the novelty cutoff only; an exact current recommendation remains a duplicate.
  const duplicateSuppressed=exact.some(h=>h.isCurrent&&h.status==="recommended");
  const overlap=history.some(h=>h.linkedFeatureIds.some(f=>linked.some(e=>e.relatedFeatureIds.includes(f))));
  const repeatType=history.some(h=>h.opportunityType===c.opportunityType);
  const eventTypes=new Set(linked.map(e=>e.type));
  const overlapEventType=history.some(h=>h.linkedDevelopmentEvents.some(e=>eventTypes.has(e.type)));
  const relevantRepetition=repeatType||overlap||overlapEventType;
  const novelty=exact.length?0:overlap&&(repeatType||overlapEventType)?.3:relevantRepetition?.55:1;
  const releaseMilestoneGrounded=(c.opportunityType==="release"&&linked.some(e=>e.type==="release"))||
   (c.opportunityType==="milestone"&&linked.some(e=>e.type==="project_milestone"||e.type==="testing_milestone"));
  const releaseMilestoneExceptionApplied=releaseMilestoneGrounded&&novelty<.35;
  const confidence=round(Math.min(c.confidence,linked.reduce((s,e)=>s+e.confidence,0)/linked.length));
  const importance=round(linked.reduce((s,e)=>s+e.importanceScore,0)/linked.length),potential=round(linked.reduce((s,e)=>s+e.contentPotentialScore,0)/linked.length);
  const ages=linked.map(e=>{const a=new Date(e.occurredAt);if(!Number.isFinite(a.getTime()))throw new Error("Invalid event date");const age=ageDay(developerDayWindow(a,input.timezone).dateString,input.developerDay);if(age===null)throw new Error("Invalid developer-day boundary");return Math.max(0,age);});
  const fresh=round(Math.max(...ages.map(freshness))),penalty=history.some(h=>h.status==="suppressed"&&(h.opportunityType===c.opportunityType||h.linkedFeatureIds.some(f=>linked.some(e=>e.relatedFeatureIds.includes(f)))||h.linkedDevelopmentEvents.some(e=>eventTypes.has(e.type))))?.18:relevantRepetition?.08:0;
  // Versioned weighted formula: importance .18 + potential .18 + freshness .14 + novelty .18 + confidence .14 + (1 - repetition penalty) .18.
  const priorityScore=round(importance*.18+potential*.18+fresh*.14+novelty*.18+confidence*.14+(1-penalty)*.18);
  const shouldPost=confidence>=.6&&(novelty>=.35||releaseMilestoneExceptionApplied)&&!duplicateSuppressed&&priorityScore>=.6;
  const reasons:ScoredOpportunityReason[]=[];const add=(code:ContentOpportunityReasonCode,effect:ContentOpportunityReasonEffect,value:number|null,eventIds=ids)=>reasons.push({code,effect,value:value===null?null:round(value),developmentEventIds:[...eventIds].sort(cmp)});
  if(importance>=.75)add("high_importance","positive",importance);if(potential>=.75)add("high_content_potential","positive",potential);if(fresh>=.8)add("fresh_work","positive",fresh);if(novelty>=.7)add("novel_topic","positive",novelty);
  const completed=linked.filter(e=>e.type==="feature_completed").map(e=>e.developmentEventId);if(completed.length)add("feature_completed","positive",null,completed);
  if(releaseMilestoneGrounded)add("release_or_milestone","positive",null);if(ids.length>1)add("multi_event_story","positive",null);
  if(duplicateSuppressed)add("duplicate_topic","negative",1);if(penalty>0)add("repetition_penalty","negative",penalty);if(novelty<.35)add("low_novelty","negative",novelty);if(confidence<.6)add("low_confidence","negative",confidence);
  const inputFingerprint=hash({task33InputFingerprint,task34,candidate:{candidateKey,eventIds:ids,type:c.opportunityType,title:c.title,format:c.recommendedFormat,topicKey,confidence:c.confidence},scoringVersion:phase3OpportunityScoringVersion,topicNormalizationVersion:phase3TopicNormalizationVersion,candidateIdentityVersion:phase3CandidateIdentityVersion});
  out.push({candidateKey,inputFingerprint,opportunityType:c.opportunityType,topicKey,title:c.title,recommendedFormat:c.recommendedFormat,priorityScore,noveltyScore:novelty,confidence,shouldPost,status:shouldPost?"recommended":"suppressed",scoringVersion:phase3OpportunityScoringVersion,isCurrent:true,developmentEventIds:ids,reasons,duplicateSuppressed,releaseMilestoneExceptionApplied});
 }
 return out.sort((a,b)=>b.priorityScore-a.priorityScore||b.confidence-a.confidence||b.noveltyScore-a.noveltyScore||cmp(a.candidateKey,b.candidateKey));
}
