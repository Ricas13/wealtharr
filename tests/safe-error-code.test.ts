import { describe, expect, it } from "vitest";
import { safeErrorCode } from "../src/lib/safe-error-code";

describe("safe stored error codes", () => {
  it("keeps the application's own codes", () => {
    expect(safeErrorCode(new Error("STRATEGY_INSTANCE_NOT_FOUND"))).toBe("STRATEGY_INSTANCE_NOT_FOUND");
    expect(safeErrorCode(new Error("MISSING_STRATEGY_INPUT:weight_A"))).toBe("MISSING_STRATEGY_INPUT:weight_A");
  });
  it("never stores driver, network or provider text", () => {
    expect(safeErrorCode(new Error('password authentication failed for user "strategyos" at db:5432'))).toBe("Error");
    class PostgresError extends Error { constructor(m: string) { super(m); this.name = "PostgresError"; } }
    expect(safeErrorCode(new PostgresError("connect ECONNREFUSED 10.0.0.5:5432"))).toBe("PostgresError");
    expect(safeErrorCode("some string")).toBe("UNKNOWN");
  });
});
