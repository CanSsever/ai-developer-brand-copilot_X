export const developmentEventTypes = [
  "feature_started",
  "feature_completed",
  "bug_fixed",
  "ui_improved",
  "architecture_decision",
  "testing_milestone",
  "performance_improvement",
  "release",
  "project_milestone",
  "refactor_completed",
] as const;

export type DevelopmentEventType = (typeof developmentEventTypes)[number];

export type DevelopmentEventStatus = "active" | "superseded" | "rejected";
