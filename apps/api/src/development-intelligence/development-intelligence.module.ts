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

@Module({})
export class DevelopmentIntelligenceModule {
  static register(config: OpenAIInterpretationConfig): DynamicModule {
    return {
      module: DevelopmentIntelligenceModule,
      providers: [
        EvidenceGroupingService,
        DevelopmentEventInterpreterService,
        ProjectStateProjectorService,
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
      ],
    };
  }
}
