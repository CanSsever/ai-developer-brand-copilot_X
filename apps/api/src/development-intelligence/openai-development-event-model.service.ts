import { Inject, Injectable } from "@nestjs/common";
import {
  developmentEventInterpretationInstructions,
  developmentEventInterpretationSchema,
  type DevelopmentEventInterpretationInput,
  type DevelopmentEventModelClient,
  type ModelInterpretationResult,
} from "@developer-brand-copilot/ai";

import {
  OPENAI_INTERPRETATION_CONFIG,
  OPENAI_INTERPRETATION_FETCH,
  type OpenAIInterpretationConfig,
} from "./development-intelligence.tokens";

export const openAiInterpretationModelConfiguration = {
  maxOutputTokens: 1_200,
  responseFormat: "strict_json_schema",
  store: false,
} as const;

export type AIProviderFailureCode =
  | "AI_CONFIGURATION_FAILURE"
  | "AI_PROVIDER_RESPONSE_INVALID"
  | "AI_PROVIDER_TRANSIENT_FAILURE"
  | "AI_REFUSAL";

export class AIProviderError extends Error {
  constructor(
    readonly failureCode: AIProviderFailureCode,
    readonly retryable: boolean
  ) {
    super("Development event AI provider request failed");
    this.name = "AIProviderError";
  }
}

interface OpenAIResponseBody {
  readonly output?: readonly {
    readonly content?: readonly {
      readonly refusal?: string;
      readonly text?: string;
      readonly type?: string;
    }[];
  }[];
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
}

function outputText(body: OpenAIResponseBody): string | null {
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" || content.refusal) {
        throw new AIProviderError("AI_REFUSAL", false);
      }
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
}

@Injectable()
export class OpenAIDevelopmentEventModelService
  implements DevelopmentEventModelClient
{
  constructor(
    @Inject(OPENAI_INTERPRETATION_CONFIG)
    private readonly config: OpenAIInterpretationConfig,
    @Inject(OPENAI_INTERPRETATION_FETCH)
    private readonly request: typeof fetch
  ) {}

  async interpret(
    input: DevelopmentEventInterpretationInput,
    repairErrors: readonly string[] = []
  ): Promise<ModelInterpretationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await this.request("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          store: false,
          max_output_tokens:
            openAiInterpretationModelConfiguration.maxOutputTokens,
          instructions: developmentEventInterpretationInstructions,
          input: JSON.stringify({
            evidence: input,
            ...(repairErrors.length > 0
              ? { repairValidationErrors: repairErrors }
              : {}),
          }),
          text: {
            format: {
              type: "json_schema",
              name: "development_event_interpretation",
              strict: true,
              schema: developmentEventInterpretationSchema,
            },
          },
        }),
        signal: controller.signal,
      });
    } catch {
      throw new AIProviderError("AI_PROVIDER_TRANSIENT_FAILURE", true);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;
      throw new AIProviderError(
        retryable
          ? "AI_PROVIDER_TRANSIENT_FAILURE"
          : "AI_CONFIGURATION_FAILURE",
        retryable
      );
    }

    let body: OpenAIResponseBody;
    try {
      body = (await response.json()) as OpenAIResponseBody;
    } catch {
      throw new AIProviderError("AI_PROVIDER_RESPONSE_INVALID", false);
    }
    const text = outputText(body);
    if (!text) {
      throw new AIProviderError("AI_PROVIDER_RESPONSE_INVALID", false);
    }

    return {
      inputTokens:
        typeof body.usage?.input_tokens === "number"
          ? body.usage.input_tokens
          : null,
      outputText: text,
      outputTokens:
        typeof body.usage?.output_tokens === "number"
          ? body.usage.output_tokens
          : null,
    };
  }
}
