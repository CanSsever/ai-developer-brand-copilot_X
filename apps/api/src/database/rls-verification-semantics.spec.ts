import { describe, expect, it, vi } from "vitest";

import {
  hasExactlyOneRow,
  hasNoVisibleRows,
  isInsertDenied,
  RlsCleanupError,
  runRlsCleanup,
  runRlsStage,
} from "./rls-verification-semantics";

describe("real RLS verification semantics", () => {
  it("accepts zero visible rows as cross-user SELECT isolation in both directions", () => {
    const hidden = { data: [], error: null };

    expect(hasNoVisibleRows(hidden)).toBe(true);
    expect(hasNoVisibleRows(hidden)).toBe(true);
  });

  it("accepts successful requests affecting zero rows as denied cross-user UPDATE and DELETE", () => {
    expect(hasNoVisibleRows({ data: [], error: null })).toBe(true);
    expect(hasNoVisibleRows({ data: [], error: null })).toBe(true);
  });

  it("requires the rightful owner to observe one unchanged row", () => {
    const ownerView = {
      data: [{ timezone: "Etc/UTC" }],
      error: null,
    };

    expect(hasExactlyOneRow(ownerView)).toBe(true);
    expect(ownerView.data[0]?.timezone).toBe("Etc/UTC");
  });

  it("requires cross-owner INSERT to return an error", () => {
    expect(isInsertDenied({ code: "policy-denied" })).toBe(true);
    expect(isInsertDenied(null)).toBe(false);
  });

  it("reports cleanup independently from isolation assertions", async () => {
    const report = vi.fn();

    await expect(
      runRlsCleanup(
        [
          { run: async () => undefined, stage: "RLS_CLEANUP_A" },
          {
            run: async () => {
              throw new Error("generic cleanup failure");
            },
            stage: "RLS_CLEANUP_B",
          },
        ],
        report
      )
    ).rejects.toBeInstanceOf(RlsCleanupError);
    expect(report.mock.calls.flat()).toEqual([
      "RLS_CLEANUP_A=passed",
      "RLS_CLEANUP_B=failed",
    ]);
  });

  it("logs only the generic stage result when an operation error contains a secret", async () => {
    const report = vi.fn();

    await expect(
      runRlsStage(
        "RLS_CROSS_PROJECT_SELECT_A_TO_B",
        async () => {
          throw new Error("private-session-value");
        },
        report
      )
    ).rejects.toThrow();
    expect(report).toHaveBeenCalledWith(
      "RLS_CROSS_PROJECT_SELECT_A_TO_B=failed"
    );
    expect(JSON.stringify(report.mock.calls)).not.toContain(
      "private-session-value"
    );
  });
});
