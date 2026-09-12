export interface HealthResponse {
  readonly status: "ok";
}

export interface DatabaseHealthResponse {
  readonly status: "ok";
  readonly database: "connected";
}
