import { Inject, Injectable } from "@nestjs/common";
import {
  opportunityDetectionInstructions,
  opportunityDetectionSchema,
  type OpportunityDetectionModelClient,
  type OpportunityDetectionModelResult,
  type OpportunityDetectionPromptInput,
} from "@developer-brand-copilot/ai";

import {
  OPENAI_INTERPRETATION_CONFIG,
  OPENAI_INTERPRETATION_FETCH,
  type OpenAIInterpretationConfig,
} from "./development-intelligence.tokens";
import {
  AIProviderError,
  classifyOpenAIHttpFailure,
  redactSensitiveValue,
} from "./openai-development-event-model.service";
import type { CanonicalPhase3OpportunityInput } from "./phase3-opportunity-input";

export const openAiOpportunityDetectionModelConfiguration = {
  inputMaxSerializedBytes: 384_000,
  maxOutputTokens: 2_400,
  responseFormat: "strict_json_schema",
  store: false,
  timeoutMs: 30_000,
} as const;

function boundedText(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  return redactSensitiveValue(value).slice(0, maximum);
}

function boundedList(values: readonly string[], maximumItems: number, maximumLength: number): string[] {
  return values.slice(0, maximumItems).map((value) => boundedText(value, maximumLength) ?? "");
}

/** Explicit semantic allowlist; no history, raw evidence, provider fields, or state provenance IDs. */
export function minimizeOpportunityDetectionInput(
  input: CanonicalPhase3OpportunityInput
): OpportunityDetectionPromptInput {
  const minimized: OpportunityDetectionPromptInput = {
    projectState: input.projectState === null ? null : {
      purpose: boundedText(input.projectState.purpose, 500),
      targetAudience: boundedText(input.projectState.targetAudience, 500),
      currentPhase: boundedText(input.projectState.currentPhase, 500),
      technologies: boundedList(input.projectState.technologies, 50, 80),
      activeFeatures: input.projectState.activeFeatures.slice(0, 20).map((feature) => ({
        title: boundedText(feature.title, 300) ?? "",
        summary: boundedText(feature.summary, 2_000) ?? "",
        technologies: boundedList(feature.technologies, 20, 80),
      })),
      completedFeatures: input.projectState.completedFeatures.slice(0, 20).map((feature) => ({
        title: boundedText(feature.title, 300) ?? "",
        summary: boundedText(feature.summary, 2_000) ?? "",
        technologies: boundedList(feature.technologies, 20, 80),
      })),
      recentMilestones: input.projectState.recentMilestones.slice(0, 20).map((feature) => ({
        title: boundedText(feature.title, 300) ?? "",
        summary: boundedText(feature.summary, 2_000) ?? "",
        technologies: boundedList(feature.technologies, 20, 80),
      })),
    },
    developmentEvents: input.developmentEvents.slice(0, 100).map((event) => ({
      developmentEventId: event.developmentEventId,
      type: event.type,
      title: boundedText(event.title, 300) ?? "",
      summary: boundedText(event.summary, 2_000) ?? "",
      importanceScore: event.importanceScore,
      contentPotentialScore: event.contentPotentialScore,
      confidence: event.confidence,
      occurredAt: event.occurredAt,
      technologies: boundedList(event.technologies, 20, 80),
      relatedFeatureIds: boundedList(event.relatedFeatureIds, 50, 80),
    })),
  };
  const bytes = Buffer.byteLength(JSON.stringify(minimized), "utf8");
  if (bytes > openAiOpportunityDetectionModelConfiguration.inputMaxSerializedBytes) {
    throw new RangeError("Opportunity detection input exceeds its bounded request size");
  }
  return minimized;
}

interface OpenAIResponseBody {
  readonly output?: readonly {
    readonly content?: readonly {
      readonly refusal?: string;
      readonly text?: string;
      readonly type?: string;
    }[];
  }[];
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

function outputText(body: OpenAIResponseBody): string | null {
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" || content.refusal) throw new AIProviderError("AI_REFUSAL", false);
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

@Injectable()
export class OpenAIOpportunityDetectionModelService implements OpportunityDetectionModelClient {
  constructor(
    @Inject(OPENAI_INTERPRETATION_CONFIG)
    private readonly config: OpenAIInterpretationConfig,
    @Inject(OPENAI_INTERPRETATION_FETCH)
    private readonly request: typeof fetch
  ) {}

  async detect(
    input: OpportunityDetectionPromptInput,
    repairErrors: readonly string[] = []
  ): Promise<OpportunityDetectionModelResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), openAiOpportunityDetectionModelConfiguration.timeoutMs);
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
          max_output_tokens: openAiOpportunityDetectionModelConfiguration.maxOutputTokens,
          instructions: opportunityDetectionInstructions,
          input: JSON.stringify({ data: input, ...(repairErrors.length > 0 ? { repairValidationErrors: repairErrors } : {}) }),
          text: {
            format: {
              type: "json_schema",
              name: "phase3_opportunity_detection",
              strict: true,
              schema: opportunityDetectionSchema,
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new AIProviderError("AI_PROVIDER_TRANSIENT_FAILURE", true);
      }
      throw new AIProviderError("AI_NETWORK_FAILURE", true);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const failure = classifyOpenAIHttpFailure(response.status);
      throw new AIProviderError(failure.failureCode, failure.retryable, failure.retryable ? failure.retryAfterAt : null);
    }
    let body: OpenAIResponseBody;
    try {
      body = (await response.json()) as OpenAIResponseBody;
    } catch {
      throw new AIProviderError("AI_PROVIDER_RESPONSE_INVALID", false);
    }
    const text = outputText(body);
    if (!text) throw new AIProviderError("AI_PROVIDER_RESPONSE_INVALID", false);
    return {
      inputTokens: typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : null,
      outputText: text,
      outputTokens: typeof body.usage?.output_tokens === "number" ? body.usage.output_tokens : null,
    };
  }
}
