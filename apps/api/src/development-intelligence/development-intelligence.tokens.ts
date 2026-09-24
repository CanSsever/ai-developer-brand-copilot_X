export const DEVELOPMENT_EVENT_MODEL_CLIENT = Symbol(
  "DEVELOPMENT_EVENT_MODEL_CLIENT"
);
export const OPPORTUNITY_DETECTION_MODEL_CLIENT = Symbol(
  "OPPORTUNITY_DETECTION_MODEL_CLIENT"
);
export const OPENAI_INTERPRETATION_CONFIG = Symbol(
  "OPENAI_INTERPRETATION_CONFIG"
);
export const OPENAI_INTERPRETATION_FETCH = Symbol(
  "OPENAI_INTERPRETATION_FETCH"
);

export interface OpenAIInterpretationConfig {
  readonly apiKey: string;
  readonly dailyAttemptLimit?: number;
  readonly model: string;
}
