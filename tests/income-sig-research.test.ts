import {describe,expect,it} from "vitest";
import {reconcileIncomeSigFlows} from "../src/domain/strategy/income-sig-research";
describe("2026 Income Sig Generator and Reserve research ledger",()=>{
  it("separates new contributions, internally transferred income and spending",()=>{
    const r=reconcileIncomeSigFlows({
      generatorOpening:"7000",reserveOpening:"3000",contributions:"1000",
      receivedDistributions:"80",confirmedProfitSkims:"120",reserveWithdrawals:"150"
    });
    expect(r.contributionsToGeneratorBondSlot).toBe("1000");
    expect(r.generatorClosing).toBe("7800");
    expect(r.reserveClosing).toBe("3050");
    expect(r.totalClosing).toBe("10850");
  });
  it("keeps internal transfers from creating portfolio value",()=>{
    const r=reconcileIncomeSigFlows({
      generatorOpening:"1500",reserveOpening:"500",contributions:"0",
      receivedDistributions:"10",confirmedProfitSkims:"100",reserveWithdrawals:"0"
    });
    expect(r.totalClosing).toBe("2000");
  });
  it("rejects exhausting the recorded reserve rather than recommending an unfunded withdrawal",()=>{
    expect(()=>reconcileIncomeSigFlows({generatorOpening:"100",reserveOpening:"10",contributions:"0",
      receivedDistributions:"0",confirmedProfitSkims:"0",reserveWithdrawals:"10.01"})).toThrow("INCOME_SIG_RESERVE_EXHAUSTED");
  });
  it("rejects transfers larger than the recorded generator and invalid amounts",()=>{
    expect(()=>reconcileIncomeSigFlows({generatorOpening:"5",reserveOpening:"0",contributions:"0",
      receivedDistributions:"2",confirmedProfitSkims:"4",reserveWithdrawals:"0"})).toThrow("INCOME_SIG_GENERATOR_EXHAUSTED");
    expect(()=>reconcileIncomeSigFlows({generatorOpening:"5",reserveOpening:"0",contributions:"-1",
      receivedDistributions:"0",confirmedProfitSkims:"0",reserveWithdrawals:"0"})).toThrow("INVALID_INCOME_SIG_INPUT");
  });
});
