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

export const openAiInterpretationEvidenceLimits = {
  maxCommitMessageLength: 500,
  maxCommits: 25,
  maxFilePathLength: 240,
  maxFilePathsPerEvidence: 40,
  maxPullRequestBodyLength: 1_500,
  maxPullRequestTitleLength: 300,
  maxPullRequests: 10,
  maxSerializedBytes: 48_000,
} as const;

export type AIProviderFailureCode =
  | "AI_REQUEST_INVALID"
  | "AI_AUTHENTICATION_FAILURE"
  | "AI_AUTHORIZATION_FAILURE"
  | "AI_MODEL_NOT_FOUND"
  | "AI_RATE_LIMITED"
  | "AI_PROVIDER_RESPONSE_INVALID"
  | "AI_PROVIDER_TRANSIENT_FAILURE"
  | "AI_NETWORK_FAILURE"
  | "AI_REFUSAL";

export class AIProviderError extends Error {
  constructor(
    readonly failureCode: AIProviderFailureCode,
    readonly retryable: boolean,
    readonly retryAfterAt: Date | null = null
  ) {
    super("Development event AI provider request failed");
    this.name = "AIProviderError";
  }
}

function retryAfterAt(response: Response): Date | null {
  const value = response.headers.get("Retry-After");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(Date.now() + Math.min(seconds, 86_400) * 1_000);
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now()
    ? new Date(Math.min(timestamp, Date.now() + 86_400_000))
    : null;
}

function redactSensitiveValue(value: string): string {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(?:Bearer\s+|Authorization\s*:\s*(?:Bearer\s+)?)[A-Za-z0-9._~+/=-]{12,}/gi, "[REDACTED_AUTHORIZATION]")
    .replace(/\b(?:sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{12,}|(?:sk|pk|gh[psuor]|github_pat)_[A-Za-z0-9_-]{12,})\b/gi, "[REDACTED_TOKEN]")
    .replace(/\b(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]{6,}/gi, "$1=[REDACTED]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^:\s/]+):[^@\s]+@/gi, "$1:[REDACTED]@");
}

function bounded(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  return redactSensitiveValue(value).slice(0, maximum);
}

/** Keeps the provider representation bounded and redacted; persisted evidence is untouched. */
export function minimizeOpenAIEvidence(input: DevelopmentEventInterpretationInput): DevelopmentEventInterpretationInput {
  const limited = {
    ...input,
    commits: input.commits.slice(0, openAiInterpretationEvidenceLimits.maxCommits).map((commit) => ({ ...commit, message: bounded(commit.message, openAiInterpretationEvidenceLimits.maxCommitMessageLength)!, filePaths: commit.filePaths.slice(0, openAiInterpretationEvidenceLimits.maxFilePathsPerEvidence).map((path) => bounded(path, openAiInterpretationEvidenceLimits.maxFilePathLength)!) })),
    pullRequests: input.pullRequests.slice(0, openAiInterpretationEvidenceLimits.maxPullRequests).map((pullRequest) => ({ ...pullRequest, bodySummary: bounded(pullRequest.bodySummary, openAiInterpretationEvidenceLimits.maxPullRequestBodyLength), filePaths: pullRequest.filePaths.slice(0, openAiInterpretationEvidenceLimits.maxFilePathsPerEvidence).map((path) => bounded(path, openAiInterpretationEvidenceLimits.maxFilePathLength)!), title: bounded(pullRequest.title, openAiInterpretationEvidenceLimits.maxPullRequestTitleLength)! })),
  };
  const serialized = JSON.stringify(limited);
  return Buffer.byteLength(serialized, "utf8") <=
    openAiInterpretationEvidenceLimits.maxSerializedBytes
    ? limited
    : {
        ...limited,
        commits: limited.commits.slice(0, 1).map((commit) => ({
          ...commit,
          filePaths: [],
        })),
        pullRequests: limited.pullRequests.slice(0, 1).map((pullRequest) => ({
          ...pullRequest,
          filePaths: [],
        })),
      };
}

export function classifyOpenAIHttpFailure(status: number): AIProviderError {
  if (status === 400) return new AIProviderError("AI_REQUEST_INVALID", false);
  if (status === 401) return new AIProviderError("AI_AUTHENTICATION_FAILURE", false);
  if (status === 403) return new AIProviderError("AI_AUTHORIZATION_FAILURE", false);
  if (status === 404) return new AIProviderError("AI_MODEL_NOT_FOUND", false);
  if (status === 429) return new AIProviderError("AI_RATE_LIMITED", true);
  if (status === 408 || status >= 500) return new AIProviderError("AI_PROVIDER_TRANSIENT_FAILURE", true);
  return new AIProviderError("AI_PROVIDER_RESPONSE_INVALID", false);
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
    const minimizedInput = minimizeOpenAIEvidence(input);
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
            evidence: minimizedInput,
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
      throw new AIProviderError("AI_NETWORK_FAILURE", true);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const failure = classifyOpenAIHttpFailure(response.status);
      throw new AIProviderError(
        failure.failureCode,
        failure.retryable,
        failure.retryable ? retryAfterAt(response) : null
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
