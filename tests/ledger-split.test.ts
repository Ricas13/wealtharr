import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertLedgerEvent, foldAccountLedger, foldLedger, ledgerRowToEvent, ledgerRowsForAccount, splitQuantityDelta } from "../src/domain/ledger";

describe("stock split ledger event", () => {
  it("computes the unit delta of a forward split exactly", () => {
    // 2-for-1 on 10 units: 10 x 2 / 1 - 10 = +10. 3-for-2 on 10 units: 10 x 3 / 2 - 10 = +5.
    expect(splitQuantityDelta("10", 2, 1).toString()).toBe("10");
    expect(splitQuantityDelta("10", 3, 2).toString()).toBe("5");
    // 2-for-1 on 0.12345678 units: x 2 = 0.24691356, delta 0.12345678.
    expect(splitQuantityDelta("0.12345678", 2, 1).toString()).toBe("0.12345678");
  });

  it("computes a negative delta for a reverse split", () => {
    // 1-for-10 on 50 units: 50 x 1 / 10 - 50 = 5 - 50 = -45. 1-for-3 on 12 units: 4 - 12 = -8.
    expect(splitQuantityDelta("50", 1, 10).toString()).toBe("-45");
    expect(splitQuantityDelta("12", 1, 3).toString()).toBe("-8");
  });

  it("refuses a 1-for-3 reverse split that would leave a repeating fraction, instead of rounding", () => {
    // 10 / 3 = 3.3333... is not exact to 8 decimals (the old 0.33333333 ratio gave 99.999999 from 300).
    expect(() => splitQuantityDelta("10", 1, 3)).toThrow("SPLIT_NOT_EXACT");
    // 1-for-8 on 3 units = 0.375 is exact and allowed; 1-for-16 on 1 unit = 0.0625 is exact too.
    expect(splitQuantityDelta("3", 1, 8).toString()).toBe("-2.625");
    expect(splitQuantityDelta("1", 1, 16).toString()).toBe("-0.9375");
    // 1-for-2^9 on 1 unit = 0.001953125 has 9 decimals: refused.
    expect(() => splitQuantityDelta("1", 1, 512)).toThrow("SPLIT_NOT_EXACT");
  });

  it("fails closed on terms that are not whole positive different numbers, or a missing holding", () => {
    expect(() => splitQuantityDelta("10", 1, 1)).toThrow("SPLIT_RATIO_INVALID");
    expect(() => splitQuantityDelta("10", 0, 1)).toThrow("SPLIT_RATIO_INVALID");
    expect(() => splitQuantityDelta("10", -2, 1)).toThrow("SPLIT_RATIO_INVALID");
    expect(() => splitQuantityDelta("10", 1.5, 1)).toThrow("SPLIT_RATIO_INVALID");
    expect(() => splitQuantityDelta("10", 2000000, 1)).toThrow("SPLIT_RATIO_INVALID");
    expect(() => splitQuantityDelta("0", 2, 1)).toThrow("SPLIT_NO_HOLDING");
  });

  it("is a quantity-only event: no cash, no fee, an instrument and a non-zero delta", () => {
    expect(() => assertLedgerEvent({ eventType: "SPLIT", cashAmount: "0", instrumentId: "x", quantity: "10" })).not.toThrow();
    expect(() => assertLedgerEvent({ eventType: "SPLIT", cashAmount: "0", instrumentId: "x", quantity: "-45" })).not.toThrow();
    expect(() => assertLedgerEvent({ eventType: "SPLIT", cashAmount: "5", instrumentId: "x", quantity: "10" })).toThrow();
    expect(() => assertLedgerEvent({ eventType: "SPLIT", cashAmount: "0", quantity: "10" })).toThrow();
    expect(() => assertLedgerEvent({ eventType: "SPLIT", cashAmount: "0", instrumentId: "x", quantity: "0" })).toThrow();
    expect(() => assertLedgerEvent({ eventType: "SPLIT", cashAmount: "0", feeAmount: "1", instrumentId: "x", quantity: "10" })).toThrow();
  });

  it("restates units through the ordinary fold without touching cash", () => {
    // Buy 10 for 1000 (cash 1000 -> 0 from a 1000 contribution), 2:1 split adds 10, later sale of 5 for 300.
    const position = foldLedger([
      { eventType: "CONTRIBUTION", currency: "GBP", cashAmount: "1000" },
      { eventType: "BUY", currency: "GBP", cashAmount: "-1000", instrumentId: "asset", quantity: "10" },
      { eventType: "SPLIT", currency: "GBP", cashAmount: "0", instrumentId: "asset", quantity: splitQuantityDelta("10", 2, 1) },
      { eventType: "SELL", currency: "GBP", cashAmount: "300", instrumentId: "asset", quantity: "-5" }
    ], "GBP");
    expect(position.quantities.get("asset")?.toString()).toBe("15");
    expect(position.cash.toFixed(2)).toBe("300.00");
  });

  it("is reversed exactly by a correction row", () => {
    const position = foldLedger([
      { eventType: "BUY", currency: "GBP", cashAmount: "-1000", instrumentId: "asset", quantity: "10" },
      { eventType: "SPLIT", currency: "GBP", cashAmount: "0", instrumentId: "asset", quantity: "10" },
      { eventType: "CORRECTION", currency: "GBP", cashAmount: "0", instrumentId: "asset", quantity: "-10" }
    ], "GBP");
    expect(position.quantities.get("asset")?.toString()).toBe("10");
  });
});

describe("ledger event_type vocabulary in the 0039 migration", () => {
  // Every event_type literal the application writes (grep of INSERT INTO ledger_events in src/).
  const WRITTEN = [
    "CONTRIBUTION", "WITHDRAWAL", "DIVIDEND", "DISTRIBUTION", "INTEREST", "FEE", "TAX", "BUY", "SELL",
    "CORRECTION", "OPENING_CASH", "OPENING_POSITION", "BROKER_ADJUSTMENT", "SPLIT"
  ];
  const migrationsDir = join(process.cwd(), "db", "migrations");
  const file = existsSync(migrationsDir) ? readdirSync(migrationsDir).find((name) => /^0039_.*\.sql$/.test(name)) : undefined;

  it("lists every literal the code writes, when that migration exists in this checkout", () => {
    if (!file) return; // 0039 lives on another branch; nothing to check here
    const sqlText = readFileSync(join(migrationsDir, file), "utf8");
    // The statement(s) that mention event_type for ledger_events, up to the next semicolon.
    const statements = [...sqlText.matchAll(/ledger_events[^;]*?event_type[^;]*;/gis)].map((match) => match[0]);
    if (statements.length === 0) return; // this migration does not constrain ledger_events.event_type
    const allowed = new Set(statements.flatMap((statement) => [...statement.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1])));
    for (const literal of WRITTEN) expect(allowed.has(literal), literal + " missing from " + file).toBe(true);
  });
});

describe("per-account ledger attribution", () => {
  const row = (accountId: string | null, eventType: string, cash: string, quantity = "0", instrument: string | null = null) => ({
    account_id: accountId, event_type: eventType, currency: "GBP", cash_amount: cash, fee_amount: "0", instrument_id: instrument, quantity
  });
  const rows = [
    row("P", "CONTRIBUTION", "100"),
    row(null, "CONTRIBUTION", "50"),
    row("S", "CONTRIBUTION", "20"),
    row(null, "BUY", "-30", "3", "asset")
  ];

  it("attributes rows with no account to the primary account only", () => {
    expect(ledgerRowsForAccount(rows, "P", "P")).toHaveLength(3);
    expect(ledgerRowsForAccount(rows, "S", "P")).toHaveLength(1);
  });

  it("folds the primary account including its null-account rows", () => {
    const primary = foldAccountLedger(rows, "P", "P", "GBP");
    // 100 + 50 - 30 = 120 cash and 3 units; the secondary account only has its own 20.
    expect(primary.cash.toFixed(2)).toBe("120.00");
    expect(primary.quantities.get("asset")?.toString()).toBe("3");
    expect(foldAccountLedger(rows, "S", "P", "GBP").cash.toFixed(2)).toBe("20.00");
  });

  it("maps a stored row to a ledger event with string numerics", () => {
    expect(ledgerRowToEvent(row("P", "BUY", "-30", "3", "asset"))).toEqual({
      eventType: "BUY", currency: "GBP", cashAmount: "-30", feeAmount: "0", instrumentId: "asset", quantity: "3"
    });
  });
});
