export interface ApiErrorResponse {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly timestamp: string;
  readonly path: string;
}
