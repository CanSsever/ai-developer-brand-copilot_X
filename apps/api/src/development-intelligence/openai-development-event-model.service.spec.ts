import { describe, expect, it, vi } from "vitest";

import {
  OPENAI_INTERPRETATION_CONFIG,
  OPENAI_INTERPRETATION_FETCH,
} from "./development-intelligence.tokens";
import {
  AIProviderError,
  OpenAIDevelopmentEventModelService,
} from "./openai-development-event-model.service";

const apiKey = "synthetic_openai_api_key_never_logged";
const model = "configured-test-model";
const evidence = {
  commits: [
    {
      additions: 1,
      committedAt: "2026-09-20T10:00:00.000Z",
      deletions: 0,
      filePaths: ["src/synthetic.ts"],
      id: "commit-1",
      message: "Synthetic private commit message",
    },
  ],
  evidenceFrom: "2026-09-20T10:00:00.000Z",
  evidenceTo: "2026-09-20T10:00:00.000Z",
  groupingReason: "standalone_commit_chain",
  groupingVersion: "evidence-grouping-v1",
  pullRequests: [],
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenAIDevelopmentEventModelService", () => {
  it("uses the configured model, store:false, and strict JSON Schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(200, {
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  decision: "insufficient_evidence",
                  event: null,
                  reason: "insufficient_detail",
                }),
              },
            ],
          },
        ],
        usage: { input_tokens: 12, output_tokens: 7 },
      })
    );
    const service = new OpenAIDevelopmentEventModelService(
      { apiKey, model },
      fetchMock as unknown as typeof fetch
    );

    const result = await service.interpret(evidence);

    expect(result).toMatchObject({ inputTokens: 12, outputTokens: 7 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model, store: false });
    expect(body.text).toMatchObject({
      format: {
        type: "json_schema",
        name: "development_event_interpretation",
        strict: true,
      },
    });
  });

  it("keeps the API key only in the backend Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(200, {
        output: [
          {
            content: [
              { type: "output_text", text: "{}" },
            ],
          },
        ],
      })
    );
    const service = new OpenAIDevelopmentEventModelService(
      { apiKey, model },
      fetchMock as unknown as typeof fetch
    );
    await service.interpret(evidence);

    const options = fetchMock.mock.calls[0]?.[1];
    expect(options?.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` });
    expect(String(options?.body)).not.toContain(apiKey);
  });

  it.each([408, 429, 500, 503])(
    "classifies HTTP %s as transient without reading the provider body",
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(
        response(status, { secretProviderPayload: "must-not-be-read" })
      );
      const service = new OpenAIDevelopmentEventModelService(
        { apiKey, model },
        fetchMock as unknown as typeof fetch
      );

      await expect(service.interpret(evidence)).rejects.toMatchObject({
        failureCode: "AI_PROVIDER_TRANSIENT_FAILURE",
        retryable: true,
      } satisfies Partial<AIProviderError>);
    }
  );

  it.each([400, 401, 403])(
    "classifies HTTP %s as terminal configuration failure",
    async (status) => {
      const service = new OpenAIDevelopmentEventModelService(
        { apiKey, model },
        vi.fn().mockResolvedValue(response(status, {})) as unknown as typeof fetch
      );
      await expect(service.interpret(evidence)).rejects.toMatchObject({
        failureCode: "AI_CONFIGURATION_FAILURE",
        retryable: false,
      } satisfies Partial<AIProviderError>);
    }
  );

  it("fails safely on refusal without exposing refusal text", async () => {
    const refusal = "Synthetic private refusal detail";
    const service = new OpenAIDevelopmentEventModelService(
      { apiKey, model },
      vi.fn().mockResolvedValue(
        response(200, {
          output: [{ content: [{ type: "refusal", refusal }] }],
        })
      ) as unknown as typeof fetch
    );
    const error = await service.interpret(evidence).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ failureCode: "AI_REFUSAL" });
    expect(String(error)).not.toContain(refusal);
  });

  it("maps network failures without a live provider call", async () => {
    const service = new OpenAIDevelopmentEventModelService(
      { apiKey, model },
      vi.fn().mockRejectedValue(new Error("synthetic network detail")) as unknown as typeof fetch
    );
    await expect(service.interpret(evidence)).rejects.toMatchObject({
      failureCode: "AI_PROVIDER_TRANSIENT_FAILURE",
      retryable: true,
    } satisfies Partial<AIProviderError>);
  });

  it("normalizes Retry-After for rate-limited durable retries", async () => {
    const service = new OpenAIDevelopmentEventModelService(
      { apiKey, model },
      vi.fn().mockResolvedValue(
        new Response("{}", {
          status: 429,
          headers: { "Retry-After": "120" },
        })
      ) as unknown as typeof fetch
    );
    const before = Date.now();
    const error = await service.interpret(evidence).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      failureCode: "AI_PROVIDER_TRANSIENT_FAILURE",
      retryable: true,
    } satisfies Partial<AIProviderError>);
    expect((error as AIProviderError).retryAfterAt?.getTime()).toBeGreaterThanOrEqual(
      before + 120_000
    );
  });

  it("exposes injectable tokens rather than a browser-facing client", () => {
    expect(typeof OPENAI_INTERPRETATION_CONFIG).toBe("symbol");
    expect(typeof OPENAI_INTERPRETATION_FETCH).toBe("symbol");
  });
});
