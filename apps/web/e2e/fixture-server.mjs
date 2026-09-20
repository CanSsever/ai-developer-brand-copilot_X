import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";
const authPort = 4100;
const apiPort = 4101;
const authOrigin = `http://${host}:${authPort}`;
const siteOrigin = "http://localhost:3100";
const userId = "123e4567-e89b-42d3-a456-426614174000";
const projectId = "323e4567-e89b-42d3-a456-426614174000";
const connectionId = "423e4567-e89b-42d3-a456-426614174000";
const syncRunId = "523e4567-e89b-42d3-a456-426614174000";

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function createAccessToken() {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      aud: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      iss: `${authOrigin}/auth/v1`,
      role: "authenticated",
      sub: userId,
    })
  );
  const signature = createHmac("sha256", "local-e2e-fixture-key")
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const accessToken = createAccessToken();
const user = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "fixture@example.invalid",
  app_metadata: { provider: "github", providers: ["github"] },
  user_metadata: {},
  identities: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

let fixtureState = "empty";
let projects = [];
let connections = [];
let syncStatusReads = 0;

function configureFixture(state) {
  fixtureState = state;
  projects = [];
  connections = [];
  syncStatusReads = 0;

  const connectedStates = [
    "connected",
    "connected-retryable",
    "connected-sync-error",
  ];
  if (["project", "installed", ...connectedStates].includes(state)) {
    projects.push({
      id: projectId,
      timezone: "Europe/Berlin",
      connectedRepository:
        connectedStates.includes(state)
          ? {
              connectionId,
              defaultBranch: "main",
              fullName: "fixture-owner/fixture-repository",
              isPrivate: true,
              status: "active",
              sync:
                state === "connected-retryable"
                  ? {
                      lastSuccessfulSyncAt: null,
                      latestRun: {
                        attemptCount: 3,
                        commitsDiscovered: 0,
                        commitsInserted: 0,
                        failureCode: "GITHUB_RATE_LIMITED",
                        finishedAt: "2026-09-19T10:00:00.000Z",
                        retryAfterAt: "2026-09-19T11:00:00.000Z",
                        startedAt: "2026-09-19T09:59:00.000Z",
                        status: "failed_retryable",
                        syncRunId,
                      },
                    }
                  : { lastSuccessfulSyncAt: null, latestRun: null },
            }
          : null,
    });
  }

  if (["installed", ...connectedStates].includes(state)) {
    connections.push({
      id: connectionId,
      accountLogin: "fixture-account",
      accountType: "User",
      status: "active",
    });
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function hasFixtureBearer(request) {
  return request.headers.authorization === `Bearer ${accessToken}`;
}

const authServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", authOrigin);

  if (request.method === "GET" && url.pathname === "/__e2e/health") {
    return sendJson(response, 200, { status: "ok" });
  }

  if (request.method === "GET" && url.pathname === "/auth/v1/authorize") {
    const redirectValue = url.searchParams.get("redirect_to");
    if (!redirectValue) return sendJson(response, 400, { message: "redirect required" });
    const redirectUrl = new URL(redirectValue);
    if (redirectUrl.origin !== siteOrigin || redirectUrl.pathname !== "/auth/callback") {
      return sendJson(response, 400, { message: "redirect rejected" });
    }
    redirectUrl.searchParams.set("code", "fixture-code");
    response.writeHead(302, { Location: redirectUrl.toString() });
    return response.end();
  }

  if (request.method === "POST" && url.pathname === "/auth/v1/token") {
    const body = await readJson(request);
    if (body.auth_code !== "fixture-code" || typeof body.code_verifier !== "string") {
      return sendJson(response, 400, { message: "invalid code exchange" });
    }
    return sendJson(response, 200, {
      access_token: accessToken,
      expires_in: 3600,
      refresh_token: "fixture-refresh-value",
      token_type: "bearer",
      user,
    });
  }

  if (request.method === "GET" && url.pathname === "/auth/v1/user") {
    return hasFixtureBearer(request)
      ? sendJson(response, 200, user)
      : sendJson(response, 401, { message: "authentication required" });
  }

  if (request.method === "POST" && url.pathname === "/auth/v1/logout") {
    response.writeHead(hasFixtureBearer(request) ? 204 : 401);
    return response.end();
  }

  return sendJson(response, 404, { message: "not found" });
});

const apiServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${apiPort}`);

  if (request.method === "GET" && url.pathname === "/__e2e/health") {
    return sendJson(response, 200, { status: "ok" });
  }

  if (request.method === "POST" && url.pathname === "/__e2e/reset") {
    const body = await readJson(request);
    const allowedStates = [
      "empty",
      "project",
      "installed",
      "connected",
      "connected-retryable",
      "connected-sync-error",
      "error",
    ];
    if (!allowedStates.includes(body.state)) {
      return sendJson(response, 400, { message: "invalid fixture state" });
    }
    configureFixture(body.state);
    return sendJson(response, 200, { status: "ok" });
  }

  if (!hasFixtureBearer(request)) {
    return sendJson(response, 401, { code: "UNAUTHORIZED", message: "Authentication required" });
  }

  if (fixtureState === "error") {
    return sendJson(response, 503, { code: "SERVICE_UNAVAILABLE", message: "Service unavailable" });
  }

  if (request.method === "GET" && url.pathname === "/projects") {
    const sync = projects[0]?.connectedRepository?.sync;
    if (sync?.latestRun?.status === "queued") {
      syncStatusReads += 1;
      if (syncStatusReads >= 2) {
        sync.lastSuccessfulSyncAt = "2026-09-19T10:00:00.000Z";
        sync.latestRun = {
          ...sync.latestRun,
          attemptCount: 4,
          commitsDiscovered: 3,
          commitsInserted: 3,
          finishedAt: "2026-09-19T10:00:00.000Z",
          startedAt: "2026-09-19T09:59:00.000Z",
          status: "succeeded",
        };
      }
    }
    return sendJson(response, 200, projects);
  }

  if (request.method === "POST" && url.pathname === "/projects") {
    const body = await readJson(request);
    if (typeof body.timezone !== "string" || body.timezone.trim() === "") {
      return sendJson(response, 400, { code: "BAD_REQUEST", message: "Invalid timezone" });
    }
    const created = {
      id: projectId,
      timezone: body.timezone.trim(),
      connectedRepository: null,
    };
    projects = [created];
    return sendJson(response, 201, created);
  }

  if (request.method === "GET" && url.pathname === "/github/connections") {
    return sendJson(response, 200, connections);
  }

  if (
    request.method === "POST" &&
    url.pathname === `/projects/${projectId}/sync-runs`
  ) {
    if (fixtureState === "connected-sync-error") {
      return sendJson(response, 503, {
        code: "SERVICE_UNAVAILABLE",
        message: "GitHub synchronization is temporarily unavailable",
      });
    }
    const project = projects[0];
    if (!project?.connectedRepository) {
      return sendJson(response, 404, {
        code: "NOT_FOUND",
        message: "Connected repository not found",
      });
    }
    project.connectedRepository.sync = {
      lastSuccessfulSyncAt: null,
      latestRun: {
        attemptCount: 0,
        commitsDiscovered: 0,
        commitsInserted: 0,
        failureCode: null,
        finishedAt: null,
        retryAfterAt: null,
        startedAt: null,
        status: "queued",
        syncRunId,
      },
    };
    syncStatusReads = 0;
    return sendJson(response, 202, { status: "queued", syncRunId });
  }

  return sendJson(response, 404, { code: "NOT_FOUND", message: "Not found" });
});

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
}

await Promise.all([listen(authServer, authPort), listen(apiServer, apiPort)]);
process.stdout.write("E2E_FIXTURES_READY\n");

function close() {
  authServer.close();
  apiServer.close();
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
