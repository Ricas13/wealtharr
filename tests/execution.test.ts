import { describe, expect, it } from "vitest";
import { assertExecutionCurrencyMatch, planPracticalTrade, validateExecution } from "../src/domain/execution";

describe("trade execution validation", () => {
  it("preserves a hand-calculated fractional fill exactly at ledger precision", () => {
    // 0.123456 × 10.25 = 1.265424; fee 0.00000001 leaves 0.73457599 from 2.
    const result=validateExecution({side:"BUY",proposedAmount:"1.265424",price:"10.25",quantity:"0.123456",fee:"0.00000001",availableCash:"2",heldQuantity:"0"});
    expect(result.grossNotional.toString()).toBe("1.265424");
    expect(result.cashAmount.minus(result.fee).toString()).toBe("-1.26542401");
  });

  it.each([
    {price:"1.000000001",quantity:"1",fee:"0"},
    {price:"1",quantity:"1.0000000000001",fee:"0"},
    {price:"1",quantity:"1",fee:"0.000000001"},
    {price:"10.25",quantity:"0.123456789",fee:"0"}
  ])("refuses silently rounded broker values: %j", (fill) => {
    expect(()=>validateExecution({side:"BUY",proposedAmount:"1",availableCash:"100",heldQuantity:"0",...fill})).toThrow("EXECUTION_PRECISION_UNSUPPORTED");
  });

  it("refuses amounts outside the database range before writing", () => {
    expect(()=>validateExecution({side:"BUY",proposedAmount:"10000000000000000",price:"100",quantity:"100000000000000",fee:"0",availableCash:"10000000000000000",heldQuantity:"0"})).toThrow("EXECUTION_AMOUNT_TOO_LARGE");
  });
  it("records actual buy notional and fee", () => {
    const result = validateExecution({
      side: "BUY",
      proposedAmount: "1000",
      price: "99",
      quantity: "10.1",
      fee: "2",
      availableCash: "1200",
      heldQuantity: "0"
    });
    expect(result.grossNotional.toFixed(2)).toBe("999.90");
    expect(result.cashAmount.toFixed(2)).toBe("-999.90");
    expect(result.fee.toFixed(2)).toBe("2.00");
  });

  it("rejects a buy that would overdraw cash including fees", () => {
    expect(() => validateExecution({
      side: "BUY",
      proposedAmount: "1000",
      price: "100",
      quantity: "10",
      fee: "5",
      availableCash: "1000",
      heldQuantity: "0"
    })).toThrow("INSUFFICIENT_CASH");
  });

  it("rejects a sell larger than the holding", () => {
    expect(() => validateExecution({
      side: "SELL",
      proposedAmount: "500",
      price: "100",
      quantity: "5",
      availableCash: "0",
      heldQuantity: "4.9"
    })).toThrow("INSUFFICIENT_HOLDINGS");
  });

  it("rejects an execution materially different from the calculated action", () => {
    expect(() => validateExecution({
      side: "BUY",
      proposedAmount: "1000",
      price: "100",
      quantity: "8",
      availableCash: "2000",
      heldQuantity: "0"
    })).toThrow("EXECUTION_NOTIONAL_MISMATCH");
  });

  it("rounds a small whole-share account down to an executable order", () => {
    const result = planPracticalTrade({
      side:"BUY",
      proposedAmount:"500",
      price:"72",
      availableCash:"500",
      heldQuantity:"0",
      constraints:{fractionalShares:false}
    });
    expect(result.status).toBe("EXECUTABLE");
    if(result.status!=="EXECUTABLE")return;
    expect(result.quantity.toString()).toBe("6");
    expect(result.amount.toFixed(2)).toBe("432.00");
    expect(result.constrained).toBe(true);
  });

  it("preserves a cash buffer and estimated fee when planning a buy", () => {
    const result = planPracticalTrade({
      side:"BUY",
      proposedAmount:"1000",
      price:"10",
      availableCash:"1000",
      heldQuantity:"0",
      constraints:{cashBufferAmount:"100",flatFee:"5"}
    });
    expect(result.status).toBe("EXECUTABLE");
    if(result.status!=="EXECUTABLE")return;
    expect(result.amount.toFixed(2)).toBe("895.00");
    expect(result.estimatedFee.toFixed(2)).toBe("5.00");
  });

  it("blocks trades below the customer minimum", () => {
    const result = planPracticalTrade({
      side:"BUY",
      proposedAmount:"40",
      price:"10",
      availableCash:"500",
      heldQuantity:"0",
      constraints:{minimumTradeAmount:"50"}
    });
    expect(result).toMatchObject({status:"BLOCKED",reason:"BELOW_MINIMUM_TRADE"});
  });

  it("blocks a sell when sell recommendations are disabled", () => {
    const result = planPracticalTrade({
      side:"SELL",
      proposedAmount:"500",
      price:"100",
      availableCash:"0",
      heldQuantity:"10",
      constraints:{allowSelling:false}
    });
    expect(result).toMatchObject({status:"BLOCKED",reason:"SELLING_DISABLED"});
  });

  it("blocks a whole-share trade that cannot buy one unit", () => {
    const result = planPracticalTrade({
      side:"BUY",
      proposedAmount:"50",
      price:"75",
      availableCash:"50",
      heldQuantity:"0",
      constraints:{fractionalShares:false}
    });
    expect(result).toMatchObject({status:"BLOCKED",reason:"BELOW_ONE_SHARE"});
  });


  it("accepts an explicitly partial fill below the proposed notional", () => {
    const result = validateExecution({
      side:"BUY",
      proposedAmount:"1000",
      price:"100",
      quantity:"4",
      availableCash:"1500",
      heldQuantity:"0",
      allowPartial:true
    });
    expect(result.grossNotional.toFixed(2)).toBe("400.00");
  });

  it("still rejects an oversized fill when marked partial", () => {
    expect(() => validateExecution({
      side:"BUY",
      proposedAmount:"1000",
      price:"100",
      quantity:"11",
      availableCash:"2000",
      heldQuantity:"0",
      allowPartial:true
    })).toThrow("EXECUTION_NOTIONAL_MISMATCH");
  });

});


describe("broker cash consideration", () => {
  // 0.123456789 x 10.25: 0.123456789 x 10 = 1.23456789; 0.123456789 x 0.25 = 0.03086419725;
  // total 1.26543208725 (11 decimals, so it cannot be stored as cash without the broker's figure).
  const base = { side: "BUY" as const, price: "10.25", quantity: "0.123456789", fee: "0.01", availableCash: "2", heldQuantity: "0" };

  it("still refuses an unrepresentable product when no consideration is supplied", () => {
    expect(() => validateExecution({ ...base, proposedAmount: "1.27" })).toThrow("EXECUTION_PRECISION_UNSUPPORTED");
  });

  it("stores the exact quantity and the broker's 2 dp consideration as cash", () => {
    // |1.27 - 1.26543208725| = 0.00456791275 <= 0.005, so the rounded broker figure is accepted.
    const result = validateExecution({ ...base, proposedAmount: "1.27", considerationAmount: "1.27" });
    expect(result.quantity.toString()).toBe("0.123456789");
    expect(result.ledgerQuantity.toString()).toBe("0.123456789");
    expect(result.grossNotional.toString()).toBe("1.27");
    expect(result.cashAmount.toString()).toBe("-1.27");
    expect(result.fee.toString()).toBe("0.01");
  });

  it("requires the consideration to be within half a penny of quantity x price", () => {
    // 1.28 - 1.26543208725 = 0.01456791275 and 1.26 is 0.00543208725 away: both outside 0.005.
    for (const considerationAmount of ["1.28", "1.26"]) {
      expect(() => validateExecution({ ...base, proposedAmount: "1.27", considerationAmount })).toThrow("EXECUTION_CONSIDERATION_MISMATCH");
    }
  });

  it("checks cash against consideration plus fee", () => {
    // 1.27 + 0.01 = 1.28 > 1.27 available.
    expect(() => validateExecution({ ...base, proposedAmount: "1.27", considerationAmount: "1.27", availableCash: "1.27" })).toThrow("INSUFFICIENT_CASH");
  });

  it("rejects a malformed consideration", () => {
    expect(() => validateExecution({ ...base, proposedAmount: "1.27", considerationAmount: "0" })).toThrow("INVALID_CONSIDERATION");
    expect(() => validateExecution({ ...base, proposedAmount: "1.27", considerationAmount: "abc" })).toThrow();
  });

  it("credits the broker consideration on a sell", () => {
    const result = validateExecution({ ...base, side: "SELL", proposedAmount: "1.27", considerationAmount: "1.27", heldQuantity: "1" });
    expect(result.cashAmount.toString()).toBe("1.27");
    expect(result.ledgerQuantity.toString()).toBe("-0.123456789");
  });
});

describe("fill price and quantity against the sizing quote", () => {
  // Instruction sized at 10 per unit for 10 units (100 notional).
  const sized = { side: "BUY" as const, proposedAmount: "100", sizingPrice: "10", instructedQuantity: "10", availableCash: "1000", heldQuantity: "0" };

  it("refuses price/10 with quantity x10, which keeps the notional equal to the instruction", () => {
    // 100 x 1 = 100 = proposed, so the old 2% notional tolerance accepted this.
    expect(() => validateExecution({ ...sized, price: "1", quantity: "100" })).toThrow("EXECUTION_PRICE_OUT_OF_BAND");
  });

  it("accepts a fill 14% from the sizing price and refuses 16%", () => {
    // |11.4 / 10 - 1| = 0.14 <= 0.15; |11.6 / 10 - 1| = 0.16 > 0.15.
    expect(validateExecution({ ...sized, price: "11.4", quantity: "10" }).grossNotional.toString()).toBe("114");
    expect(() => validateExecution({ ...sized, price: "11.6", quantity: "10" })).toThrow("EXECUTION_PRICE_OUT_OF_BAND");
  });

  it("validates quantity against the instructed quantity separately", () => {
    // Upper bound is 10 x 1.02 = 10.2 inclusive.
    expect(validateExecution({ ...sized, price: "10", quantity: "10.2" }).quantity.toString()).toBe("10.2");
    expect(() => validateExecution({ ...sized, price: "10", quantity: "10.3" })).toThrow("EXECUTION_QUANTITY_MISMATCH");
    // Lower bound is 10 x 0.98 = 9.8 for a full fill.
    expect(() => validateExecution({ ...sized, price: "10", quantity: "9.7" })).toThrow("EXECUTION_QUANTITY_MISMATCH");
  });

  it("lets an explicitly partial fill be smaller but never escape the price band", () => {
    expect(validateExecution({ ...sized, price: "10", quantity: "4", allowPartial: true }).grossNotional.toString()).toBe("40");
    expect(() => validateExecution({ ...sized, price: "1", quantity: "4", allowPartial: true })).toThrow("EXECUTION_PRICE_OUT_OF_BAND");
    expect(() => validateExecution({ ...sized, price: "10", quantity: "4" })).toThrow("EXECUTION_QUANTITY_MISMATCH");
  });
});

describe("execution currency invariant", () => {
  it("accepts the same currency and returns a canonical code", () => {
    expect(assertExecutionCurrencyMatch("gbp", "GBP")).toBe("GBP");
  });

  it("rejects a currency mismatch", () => {
    expect(() => assertExecutionCurrencyMatch("USD", "GBP")).toThrow("EXECUTION_CURRENCY_MISMATCH");
  });

  it("fails closed when either currency is missing", () => {
    expect(() => assertExecutionCurrencyMatch(null, "GBP")).toThrow("EXECUTION_CURRENCY_MISMATCH");
    expect(() => assertExecutionCurrencyMatch("GBP", undefined)).toThrow("EXECUTION_CURRENCY_MISMATCH");
  });
});
