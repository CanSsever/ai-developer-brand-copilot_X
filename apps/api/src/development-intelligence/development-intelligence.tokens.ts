export const DEVELOPMENT_EVENT_MODEL_CLIENT = Symbol(
  "DEVELOPMENT_EVENT_MODEL_CLIENT"
);
export const OPENAI_INTERPRETATION_CONFIG = Symbol(
  "OPENAI_INTERPRETATION_CONFIG"
);
export const OPENAI_INTERPRETATION_FETCH = Symbol(
  "OPENAI_INTERPRETATION_FETCH"
);

export interface OpenAIInterpretationConfig {
  readonly apiKey: string;
  readonly model: string;
}
