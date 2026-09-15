export interface RlsRowsResult<T> {
  readonly data: readonly T[] | null;
  readonly error: unknown;
}

export type RlsStageReporter = (result: string) => void;

export class RlsCleanupError extends Error {
  constructor() {
    super("Temporary Project cleanup failed");
    this.name = "RlsCleanupError";
  }
}

export function hasExactlyOneRow<T>(
  result: RlsRowsResult<T>
): result is RlsRowsResult<T> & { readonly data: readonly [T] } {
  return !result.error && result.data?.length === 1;
}

export function hasNoVisibleRows(result: RlsRowsResult<unknown>): boolean {
  return !result.error && result.data?.length === 0;
}

export function isInsertDenied(error: unknown): boolean {
  return Boolean(error);
}

export async function runRlsStage<T>(
  stage: string,
  operation: () => Promise<T>,
  report: RlsStageReporter = (result) => console.error(result)
): Promise<T> {
  try {
    const value = await operation();
    report(stage + "=passed");
    return value;
  } catch (error) {
    report(stage + "=failed");
    throw error;
  }
}

export async function runRlsCleanup(
  operations: ReadonlyArray<{
    readonly run: () => Promise<void>;
    readonly stage: string;
  }>,
  report?: RlsStageReporter
): Promise<void> {
  const results = await Promise.allSettled(
    operations.map(({ run, stage }) => runRlsStage(stage, run, report))
  );

  if (results.some(({ status }) => status === "rejected")) {
    throw new RlsCleanupError();
  }
}
