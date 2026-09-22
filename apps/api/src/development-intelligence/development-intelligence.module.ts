import { Module } from "@nestjs/common";

import { EvidenceGroupingService } from "./evidence-grouping.service";

@Module({
  providers: [EvidenceGroupingService],
  exports: [EvidenceGroupingService],
})
export class DevelopmentIntelligenceModule {}
