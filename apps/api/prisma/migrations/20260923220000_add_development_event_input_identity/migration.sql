DROP INDEX "DevelopmentEvent_projectId_eventKey_extractionVersion_key";

CREATE UNIQUE INDEX "DevelopmentEvent_projectId_eventKey_extractionVersion_inputFingerprint_key"
ON "DevelopmentEvent"("projectId", "eventKey", "extractionVersion", "inputFingerprint");
