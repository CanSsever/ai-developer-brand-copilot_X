import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";

import { EvidenceGroupingService } from "./evidence-grouping.service";
import { DevelopmentEventInterpreterService } from "./development-event-interpreter.service";
import {
  DEVELOPMENT_EVENT_MODEL_CLIENT,
  OPENAI_INTERPRETATION_CONFIG,
  OPENAI_INTERPRETATION_FETCH,
  OPPORTUNITY_DETECTION_MODEL_CLIENT,
  type OpenAIInterpretationConfig,
} from "./development-intelligence.tokens";
import { OpenAIDevelopmentEventModelService } from "./openai-development-event-model.service";
import { OpenAIOpportunityDetectionModelService } from "./openai-opportunity-detection-model.service";
import { ProjectStateProjectorService } from "./project-state-projector.service";
import {
  defaultIntelligencePipelineWorkerOptions,
  IntelligencePipelineWorkerService,
} from "./intelligence-pipeline-worker.service";
import { IntelligencePipelineService } from "./intelligence-pipeline.service";
import {
  INTELLIGENCE_PIPELINE_CLOCK,
  INTELLIGENCE_PIPELINE_WORKER_OPTIONS,
} from "./intelligence-pipeline.tokens";
import { IntelligenceReadController } from "./intelligence-read.controller";
import { IntelligenceReadService } from "./intelligence-read.service";
import {
  DAILY_SUMMARY_CLOCK,
  DailyDevelopmentSummaryService,
} from "./daily-development-summary.service";
import { Phase3OpportunityInputSelectorService } from "./phase3-opportunity-input-selector.service";
import { OpportunityDetectionService } from "./opportunity-detection.service";
import { ContentOpportunityScoringService } from "./content-opportunity-scoring.service";

@Module({})
export class DevelopmentIntelligenceModule {
  static register(config: OpenAIInterpretationConfig): DynamicModule {
    return {
      module: DevelopmentIntelligenceModule,
      global: true,
      controllers: [IntelligenceReadController],
      providers: [
        EvidenceGroupingService,
        DevelopmentEventInterpreterService,
        ProjectStateProjectorService,
        IntelligencePipelineService,
        IntelligencePipelineWorkerService,
        IntelligenceReadService,
        DailyDevelopmentSummaryService,
        Phase3OpportunityInputSelectorService,
        OpportunityDetectionService,
        ContentOpportunityScoringService,
        { provide: DAILY_SUMMARY_CLOCK, useValue: () => new Date() },
        { provide: INTELLIGENCE_PIPELINE_CLOCK, useValue: () => new Date() },
        {
          provide: INTELLIGENCE_PIPELINE_WORKER_OPTIONS,
          useValue: defaultIntelligencePipelineWorkerOptions,
        },
        { provide: OPENAI_INTERPRETATION_CONFIG, useValue: config },
        { provide: OPENAI_INTERPRETATION_FETCH, useValue: fetch },
        OpenAIDevelopmentEventModelService,
        OpenAIOpportunityDetectionModelService,
        {
          provide: DEVELOPMENT_EVENT_MODEL_CLIENT,
          useExisting: OpenAIDevelopmentEventModelService,
        },
        {
          provide: OPPORTUNITY_DETECTION_MODEL_CLIENT,
          useExisting: OpenAIOpportunityDetectionModelService,
        },
      ],
      exports: [
        EvidenceGroupingService,
        DevelopmentEventInterpreterService,
        ProjectStateProjectorService,
        IntelligencePipelineService,
        IntelligencePipelineWorkerService,
        OpportunityDetectionService,
        ContentOpportunityScoringService,
      ],
    };
  }
}
