import { describe, expect, it } from "vitest";
import { assertLedgerEvent, foldAccountLedger, foldLedger, ledgerRowToEvent, ledgerRowsForAccount, splitQuantityDelta } from "../src/domain/ledger";

describe("stock split ledger event", () => {
  it("computes the unit delta of a forward split exactly", () => {
    // 2:1 on 10 units: 10 x 2 - 10 = +10. 3:2 on 10 units: 10 x 1.5 - 10 = +5.
    expect(splitQuantityDelta("10", "2").toString()).toBe("10");
    expect(splitQuantityDelta("10", "1.5").toString()).toBe("5");
    // 2:1 on 0.123456789012 units: x 2 = 0.246913578024, delta 0.123456789012.
    expect(splitQuantityDelta("0.123456789012", "2").toString()).toBe("0.123456789012");
  });

  it("computes a negative delta for a reverse split", () => {
    // 1:10 on 50 units: 50 x 0.1 - 50 = -45.
    expect(splitQuantityDelta("50", "0.1").toString()).toBe("-45");
  });

  it("fails closed on a ratio that has no clean effect, a missing holding or sub-quantity precision", () => {
    expect(() => splitQuantityDelta("10", "1")).toThrow("SPLIT_RATIO_INVALID");
    expect(() => splitQuantityDelta("10", "0")).toThrow("SPLIT_RATIO_INVALID");
    expect(() => splitQuantityDelta("10", "-2")).toThrow("SPLIT_RATIO_INVALID");
    expect(() => splitQuantityDelta("10", "100000")).toThrow("SPLIT_RATIO_INVALID");
    expect(() => splitQuantityDelta("0", "2")).toThrow("SPLIT_NO_HOLDING");
    // 0.000000000001 (1e-12) x 0.5 = 5e-13 needs 13 decimals.
    expect(() => splitQuantityDelta("0.000000000001", "0.5")).toThrow("SPLIT_PRECISION_UNSUPPORTED");
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
      { eventType: "SPLIT", currency: "GBP", cashAmount: "0", instrumentId: "asset", quantity: splitQuantityDelta("10", "2") },
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
