import { describe, expect, it, vi } from "vitest";

import {
  developmentEventInterpretationSchema,
} from "@developer-brand-copilot/ai";
import {
  OPENAI_INTERPRETATION_CONFIG,
  OPENAI_INTERPRETATION_FETCH,
} from "./development-intelligence.tokens";
import {
  AIProviderError,
  minimizeOpenAIEvidence,
  OpenAIDevelopmentEventModelService,
} from "./openai-development-event-model.service";

const apiKey = "synthetic_openai_api_key_never_logged";
const model = "configured-test-model";
const evidence = {
  activeFeatures: [],
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
    expect(body.text).toMatchObject({
      format: { schema: developmentEventInterpretationSchema },
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

  it.each([408, 500, 503])(
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

  it.each([[400, "AI_REQUEST_INVALID"], [401, "AI_AUTHENTICATION_FAILURE"], [403, "AI_AUTHORIZATION_FAILURE"], [404, "AI_MODEL_NOT_FOUND"]] as const)(
    "classifies HTTP %s as a safe terminal provider category",
    async (status, failureCode) => {
      const service = new OpenAIDevelopmentEventModelService(
        { apiKey, model },
        vi.fn().mockResolvedValue(response(status, {})) as unknown as typeof fetch
      );
      await expect(service.interpret(evidence)).rejects.toMatchObject({
        failureCode,
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
      failureCode: "AI_NETWORK_FAILURE",
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
      failureCode: "AI_RATE_LIMITED",
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

  it("redacts sensitive values and bounds only the provider representation", () => {
    const prepared = minimizeOpenAIEvidence({
      ...evidence,
      commits: [{ ...evidence.commits[0]!, message: "token=super-secret-value ghp_abcdefghijklmnop" }],
    });
    expect(prepared.commits[0]?.message).toContain("[REDACTED]");
    expect(prepared.commits[0]?.message).not.toContain("super-secret-value");
    expect(evidence.commits[0]?.message).toBe("Synthetic private commit message");
  });

  it.each([
    ["OpenAI project key", `sk-proj-${"a".repeat(32)}`],
    ["existing OpenAI key", `sk-${"b".repeat(32)}`],
    ["GitHub personal token", `ghp_${"c".repeat(32)}`],
    ["GitHub fine-grained token", `github_pat_${"d".repeat(32)}`],
    ["GitHub user token", `ghu_${"e".repeat(32)}`],
    ["Bearer credential", `Bearer ${"f".repeat(24)}`],
    ["Authorization header credential", `Authorization: Bearer ${"g".repeat(24)}`],
  ])("redacts %s from provider evidence", (_label, secret) => {
    const prepared = minimizeOpenAIEvidence({
      ...evidence,
      commits: [{ ...evidence.commits[0]!, message: `before ${secret} after` }],
    });

    expect(prepared.commits[0]?.message).toContain("[REDACTED_");
    expect(prepared.commits[0]?.message).not.toContain(secret);
  });

  it("redacts private keys, assignments, URLs, and multiple secrets without mutating records", () => {
    const projectToken = `sk-proj-${"h".repeat(32)}`;
    const githubToken = `ghp_${"i".repeat(32)}`;
    const privateKey = "-----BEGIN PRIVATE KEY-----\\nprivate-material\\n-----END PRIVATE KEY-----";
    const databaseUrl = "postgresql://user:database-password@example.test/app";
    const input = {
      ...evidence,
      commits: [
        {
          ...evidence.commits[0]!,
          message: `token=${projectToken}; secret=commit-secret-value; ${privateKey}`,
        },
      ],
      pullRequests: [
        {
          additions: 2,
          bodySummary: `password=pr-password-value ${databaseUrl}`,
          deletions: 1,
          filePaths: ["src/normal.ts"],
          id: "pr-1",
          mergedAt: "2026-09-20T10:00:00.000Z",
          title: `Ship ${githubToken} safely`,
        },
      ],
    };

    const prepared = minimizeOpenAIEvidence(input);
    const serialized = JSON.stringify(prepared);
    for (const secret of [
      projectToken,
      githubToken,
      "commit-secret-value",
      "private-material",
      "pr-password-value",
      "database-password",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("Ship");
    expect(input.commits[0]?.message).toContain(projectToken);
    expect(input.pullRequests[0]?.title).toContain(githubToken);
  });

  it("sends only sanitized evidence to the model adapter and keeps sensitive errors safe", async () => {
    const secret = `sk-proj-${"j".repeat(32)}`;
    const fetchMock = vi.fn().mockResolvedValue(
      response(200, {
        output: [{ content: [{ type: "output_text", text: "{}" }] }],
      })
    );
    const service = new OpenAIDevelopmentEventModelService(
      { apiKey, model },
      fetchMock as unknown as typeof fetch
    );
    const input = {
      ...evidence,
      commits: [{ ...evidence.commits[0]!, message: `release ${secret}` }],
    };

    await service.interpret(input);
    const sent = String(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).input);
    expect(sent).not.toContain(secret);
    expect(sent).toContain("[REDACTED_TOKEN]");
    expect(input.commits[0]?.message).toContain(secret);

    const failingService = new OpenAIDevelopmentEventModelService(
      { apiKey, model },
      vi.fn().mockRejectedValue(new Error(`provider detail ${secret}`)) as unknown as typeof fetch
    );
    const error = await failingService.interpret(input).catch((caught: unknown) => caught);
    expect(String(error)).not.toContain(secret);
  });

  it("retains structural sensitive-looking file paths because the PDR permits file-path metadata", () => {
    const filePaths = [".env", ".env.production", "keys/service.pem", "id_rsa", "credentials.json", "secrets.yaml"];
    const prepared = minimizeOpenAIEvidence({
      ...evidence,
      commits: [{ ...evidence.commits[0]!, filePaths }],
    });

    expect(prepared.commits[0]?.filePaths).toEqual(filePaths);
  });

  it("enforces the serialized provider limit in UTF-8 bytes", () => {
    const prepared = minimizeOpenAIEvidence({
      ...evidence,
      commits: Array.from({ length: 25 }, (_, index) => ({
        ...evidence.commits[0]!,
        filePaths: Array.from({ length: 40 }, () => "秘密/".repeat(80)),
        id: `commit-${index}`,
        message: "秘密".repeat(500),
      })),
    });
    expect(Buffer.byteLength(JSON.stringify(prepared), "utf8")).toBeLessThanOrEqual(
      48_000
    );
  });
});
