import type { DynamicModule } from "@nestjs/common";
import { Module } from "@nestjs/common";

import { EvidenceGroupingService } from "./evidence-grouping.service";
import { DevelopmentEventInterpreterService } from "./development-event-interpreter.service";
import {
  DEVELOPMENT_EVENT_MODEL_CLIENT,
  OPENAI_INTERPRETATION_CONFIG,
  OPENAI_INTERPRETATION_FETCH,
  type OpenAIInterpretationConfig,
} from "./development-intelligence.tokens";
import { OpenAIDevelopmentEventModelService } from "./openai-development-event-model.service";
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

@Module({})
export class DevelopmentIntelligenceModule {
  static register(config: OpenAIInterpretationConfig): DynamicModule {
    return {
      module: DevelopmentIntelligenceModule,
      global: true,
      providers: [
        EvidenceGroupingService,
        DevelopmentEventInterpreterService,
        ProjectStateProjectorService,
        IntelligencePipelineService,
        IntelligencePipelineWorkerService,
        { provide: INTELLIGENCE_PIPELINE_CLOCK, useValue: () => new Date() },
        {
          provide: INTELLIGENCE_PIPELINE_WORKER_OPTIONS,
          useValue: defaultIntelligencePipelineWorkerOptions,
        },
        { provide: OPENAI_INTERPRETATION_CONFIG, useValue: config },
        { provide: OPENAI_INTERPRETATION_FETCH, useValue: fetch },
        OpenAIDevelopmentEventModelService,
        {
          provide: DEVELOPMENT_EVENT_MODEL_CLIENT,
          useExisting: OpenAIDevelopmentEventModelService,
        },
      ],
      exports: [
        EvidenceGroupingService,
        DevelopmentEventInterpreterService,
        ProjectStateProjectorService,
        IntelligencePipelineService,
        IntelligencePipelineWorkerService,
      ],
    };
  }
}
