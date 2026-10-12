import { describe, expect, it } from "vitest";
import { classifyBacklog, recheckIntervalHours } from "@/domain/backlog";

const HOUR = 3_600_000;
const base = { remaining: true, progressed: 10, overdueMs: HOUR, toleranceMs: 6 * HOUR };

describe("backlog classification", () => {
  it("is clear when nothing was left behind, whatever else is true", () => {
    expect(classifyBacklog({ ...base, remaining: false })).toBe("CLEAR");
    expect(classifyBacklog({ ...base, remaining: false, progressed: 0, overdueMs: null })).toBe("CLEAR");
  });

  it("is a backlog while work remains but the run progressed and nothing is overdue beyond tolerance", () => {
    expect(classifyBacklog(base)).toBe("BACKLOG");
    expect(classifyBacklog({ ...base, overdueMs: 0 })).toBe("BACKLOG");
    expect(classifyBacklog({ ...base, overdueMs: 6 * HOUR })).toBe("BACKLOG");
  });

  it("is stalled when no progress was made", () => {
    expect(classifyBacklog({ ...base, progressed: 0 })).toBe("STALLED");
  });

  it("is stalled when the oldest item is overdue beyond the tolerance (the backlog is aging)", () => {
    expect(classifyBacklog({ ...base, overdueMs: 6 * HOUR + 1 })).toBe("STALLED");
  });

  it("fails closed when the age is unknown or not a number", () => {
    expect(classifyBacklog({ ...base, overdueMs: null })).toBe("STALLED");
    expect(classifyBacklog({ ...base, overdueMs: Number.NaN })).toBe("STALLED");
    expect(classifyBacklog({ ...base, overdueMs: Infinity })).toBe("STALLED");
  });
});

describe("reconciliation recheck interval", () => {
  it("stays hourly while one run covers every subscription", () => {
    expect(recheckIntervalHours(0, 100)).toBe(1);
    expect(recheckIntervalHours(1, 100)).toBe(1);
    expect(recheckIntervalHours(100, 100)).toBe(1);
  });

  it("grows so an hourly run of the cap keeps up, up to a day", () => {
    expect(recheckIntervalHours(101, 100)).toBe(2);
    expect(recheckIntervalHours(1_000, 100)).toBe(10);
    expect(recheckIntervalHours(2_400, 100)).toBe(24);
    expect(recheckIntervalHours(50_000, 100)).toBe(24);
  });

  it("falls back to hourly on nonsense input rather than throwing", () => {
    expect(recheckIntervalHours(Number.NaN, 100)).toBe(1);
    expect(recheckIntervalHours(10, 0)).toBe(1);
  });
});
