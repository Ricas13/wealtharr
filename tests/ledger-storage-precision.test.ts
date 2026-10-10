import {describe,expect,it} from "vitest";
import {validateExecution} from "../src/domain/execution";
import {historicalBrokerFill} from "../src/domain/historical-trade";
import {foldLedger} from "../src/domain/ledger";

describe("exact arithmetic across the ledger's numeric range",()=>{
  const at=new Date("2020-01-02T15:00:00Z");
  const amount="9999999999999999.12345678";
  it("preserves all 24 stored digits through fills and ledger folding",()=>{
    // Multiplying by 1 changes nothing; subtracting the integer leaves the fraction.
    const actual=validateExecution({side:"BUY",proposedAmount:amount,price:"1",quantity:amount,
      fee:"0.00000001",availableCash:"9999999999999999.12345679",heldQuantity:"0"});
    expect(actual.grossNotional.toFixed(8)).toBe(amount);
    const imported=historicalBrokerFill({side:"BUY",quantity:amount,unitPrice:"1",fee:"0.00000001",executedAt:at,currency:"USD"});
    expect(imported.grossNotional.toFixed(8)).toBe(amount);
    const position=foldLedger([
      {eventType:"CONTRIBUTION",currency:"USD",cashAmount:"9999999999999999.12345679"},
      {eventType:"BUY",currency:"USD",cashAmount:imported.cashAmount,feeAmount:imported.feeAmount,
        instrumentId:"fixture",quantity:imported.quantity},
      {eventType:"SELL",currency:"USD",cashAmount:"9999999999999999",instrumentId:"fixture",quantity:"-9999999999999999"}
    ],"USD");
    expect(position.cash.toFixed(8)).toBe("9999999999999999.00000000");
    expect(position.quantities.get("fixture")?.toFixed(8)).toBe("0.12345678");
  });
  it("does not round away an overdraft of one smallest stored cash unit",()=>{
    expect(()=>validateExecution({side:"BUY",proposedAmount:amount,price:"1",quantity:amount,
      fee:"0.00000001",availableCash:amount,heldQuantity:"0"})).toThrow("INSUFFICIENT_CASH");
  });
  it("checks product precision before any significant-digit rounding",()=>{
    const quantity="9999999999999999.123456789";
    expect(()=>validateExecution({side:"BUY",proposedAmount:amount,price:"1",quantity,
      availableCash:amount,heldQuantity:"0"})).toThrow("EXECUTION_PRECISION_UNSUPPORTED");
    expect(()=>historicalBrokerFill({side:"BUY",quantity,unitPrice:"1",fee:"0",executedAt:at,currency:"USD"}))
      .toThrow("TRADE_NOTIONAL_PRECISION_UNSUPPORTED");
  });
  it.each([
    {quantity:"1000000000000000000",unitPrice:"0.00000001",fee:"0"},
    {quantity:"0.00000001",unitPrice:"100000000000000",fee:"0"},
    {quantity:"1",unitPrice:"1",fee:"10000000000000000"}
  ])("rejects independently overflowing stored fields: %j",fill=>{
    expect(()=>historicalBrokerFill({...fill,side:"BUY",executedAt:at,currency:"USD"})).toThrow("TRADE_TOO_LARGE");
  });
});
