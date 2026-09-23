ALTER TABLE "AIExecution"
ADD COLUMN "extractionVersion" VARCHAR(64);

CREATE INDEX "AIExecution_projectId_stage_inputFingerprint_extractionVersion_idx"
ON "AIExecution"("projectId", "stage", "inputFingerprint", "extractionVersion");
