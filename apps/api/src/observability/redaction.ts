const redacted = "[REDACTED]";

const sensitiveKeys = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "token",
  "clientsecret",
  "privatekey",
  "password",
  "databaseurl",
  "directurl",
  "supabasecredentials",
  "supabasekey",
  "supabasepublishablekey",
  "supabaseservicerolekey",
  "githuboauthcode",
  "oauthcode",
  "authorizationcode",
  "code",
  "installationtoken",
  "useraccesstoken",
]);

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);

  return (
    sensitiveKeys.has(normalized) ||
    normalized.endsWith("accesstoken") ||
    normalized.endsWith("refreshtoken") ||
    normalized.endsWith("clientsecret") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("password")
  );
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, `Bearer ${redacted}`)
    .replace(
      /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/g,
      redacted
    )
    .replace(/\b(?:gh[uspor]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gi, redacted)
    .replace(/(postgres(?:ql)?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${redacted}@`);
}

function redactInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name };
  if (seen.has(value)) return "[Circular]";

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactInternal(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = isSensitiveKey(key)
      ? redacted
      : redactInternal(child, seen);
  }
  return result;
}

export function redact(value: unknown): unknown {
  return redactInternal(value, new WeakSet<object>());
}

export { redacted as REDACTED_VALUE };
