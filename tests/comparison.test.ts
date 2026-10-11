import { describe,expect,it } from "vitest";
import { simulateSameCashFlows } from "../src/domain/comparison";

describe("same-cash-flow comparison",()=>{
  it("scales an index to the user's first tracked value",()=>{
    const result=simulateSameCashFlows({
      index:[{date:"2026-01-01",value:"100"},{date:"2026-02-01",value:"110"}],
      anchorDate:"2026-01-01",
      anchorValue:"1000",
      flows:[]
    });
    expect(result.map(p=>p.value.toFixed(2))).toEqual(["1000.00","1100.00"]);
  });

  it("applies later contributions to both model and benchmark rather than treating deposits as alpha",()=>{
    const result=simulateSameCashFlows({
      index:[
        {date:"2026-01-01",value:"100"},
        {date:"2026-01-15",value:"100"},
        {date:"2026-02-01",value:"100"},
        {date:"2026-03-01",value:"110"}
      ],
      anchorDate:"2026-01-01",
      anchorValue:"1000",
      flows:[{date:"2026-01-15",amount:"500"}]
    });
    expect(result.map(p=>p.value.toFixed(2))).toEqual(["1000.00","1500.00","1500.00","1650.00"]);
  });

  it("refuses comparisons when the benchmark lacks an exact opening date",()=>{
    expect(simulateSameCashFlows({index:[{date:"2026-01-06",value:"100"}],
      anchorDate:"2026-01-05",anchorValue:"1000",flows:[]})).toEqual([]);
  });

  it("never accepts duplicate quote dates as independent benchmark observations",()=>{
    expect(()=>simulateSameCashFlows({index:[{date:"2026-01-05",value:"100"},{date:"2026-01-05",value:"101"}],
      anchorDate:"2026-01-05",anchorValue:"1000",flows:[]})).toThrow("DUPLICATE_BENCHMARK_DATE");
  });

  it("fails closed if a contribution day has no benchmark close, rather than pricing it in hindsight",()=>{
    expect(simulateSameCashFlows({
      index:[{date:"2026-01-05",value:"100"},{date:"2026-01-07",value:"200"}],
      anchorDate:"2026-01-05",anchorValue:"1000",
      flows:[{date:"2026-01-06",amount:"500"}]
    })).toEqual([]);
  });
  it("rejects bad benchmark observations rather than silently filtering them out",()=>{
    expect(()=>simulateSameCashFlows({
      index:[{date:"2026-01-05",value:"100"},{date:"2026-01-06",value:"-50"},{date:"2026-01-07",value:"110"}],
      anchorDate:"2026-01-05",anchorValue:"1000",flows:[]
    })).toThrow("INVALID_BENCHMARK_SERIES");
  });
  it("handles withdrawals as negative external cash flows",()=>{
    const result=simulateSameCashFlows({
      index:[{date:"2026-01-01",value:"100"},{date:"2026-01-15",value:"100"},{date:"2026-02-01",value:"100"}],
      anchorDate:"2026-01-01",
      anchorValue:"1000",
      flows:[{date:"2026-01-15",amount:"-200"}]
    });
    expect(result.at(-1)?.value.toFixed(2)).toBe("800.00");
  });
});
