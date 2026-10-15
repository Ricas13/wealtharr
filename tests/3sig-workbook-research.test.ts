import {describe,expect,it} from "vitest";
import Decimal from "decimal.js";
import {calculateHistoricalThreeSigQuarter} from "../src/domain/strategy/3sig-workbook-research";

describe("original Jason Kelly book-era 3Sig worksheet, source-derived golden tests",()=>{
  it("reproduces two consecutive published workbook quarters including all distributions",()=>{
    const q1Input={
      previousStockShares:new Decimal("8000").div("108.09"),
      previousStockClose:"108.09",
      previousBondShares:new Decimal("2000").div("10.24"),
      stockClose:"101.5",bondClose:"10.35",
      stockDividendPerShare:"0.04",bondDistributionPerShare:"0.17",
      contribution:"1215"
    };
    const q1=calculateHistoricalThreeSigQuarter(q1Input);
    expect(q1.targetStockValue).toBe("8847.5");
    expect(new Decimal(q1.desiredShareDelta).toDecimalPlaces(8).toString()).toBe("13.15509061");
    expect(new Decimal(q1.bondSharesBeforeTrade).toDecimalPlaces(8).toString()).toBe("316.197874");
    expect(q1.externalCashNeededIfFullyFilled).toBe("0");
    const confirmedQ1=calculateHistoricalThreeSigQuarter({...q1Input,confirmedStockShareDelta:q1.desiredShareDelta});
    expect(new Decimal(confirmedQ1.confirmedStockValueAfterTrade!).toDecimalPlaces(2).toString()).toBe("8847.5");
    expect(new Decimal(confirmedQ1.confirmedBondValueAfterTrade!).toDecimalPlaces(4).toString()).toBe("1937.4063");
    const q2Input={
      previousStockShares:confirmedQ1.confirmedStockSharesAfterTrade!,
      previousStockClose:"101.5",
      previousBondShares:confirmedQ1.confirmedBondSharesAfterTrade!,
      stockClose:"114.01",bondClose:"10.29",
      stockDividendPerShare:"0.036",bondDistributionPerShare:"0.167",
      contribution:"1215"
    };
    const q2=calculateHistoricalThreeSigQuarter(q2Input);
    expect(new Decimal(q2.targetStockValue).toDecimalPlaces(3).toString()).toBe("9720.425");
    expect(new Decimal(q2.desiredShareDelta).toDecimalPlaces(8).toString()).toBe("-1.90808062");
    expect(new Decimal(q2.bondSharesBeforeTrade).toDecimalPlaces(6).toString()).toBe("308.607731");
    const confirmedQ2=calculateHistoricalThreeSigQuarter({...q2Input,confirmedStockShareDelta:q2.desiredShareDelta});
    expect(new Decimal(confirmedQ2.confirmedBondValueAfterTrade!).toDecimalPlaces(4).toString()).toBe("3393.1138");
  });
  it("does not invent funded orders or allow reserve overdrafts",()=>{
    const input={previousStockShares:"10",previousStockClose:"100",previousBondShares:"0",
      stockClose:"20",bondClose:"10",stockDividendPerShare:"0",
      bondDistributionPerShare:"0",contribution:"0"};
    const projection=calculateHistoricalThreeSigQuarter(input);
    expect(projection.externalCashNeededIfFullyFilled).toBe("830");
    expect(projection.confirmedStockSharesAfterTrade).toBeNull();
    expect(()=>calculateHistoricalThreeSigQuarter({...input,confirmedStockShareDelta:"41.5"}))
      .toThrow("3SIG_CONFIRMED_TRADE_EXCEEDS_HOLDINGS");
  });
});
