import {describe,expect,it} from "vitest";
import {plugin} from "../src/domain/strategy/catalog/9sig";

describe("9Sig unverified release safeguards",()=>{
  it("does not publish an incomplete proprietary variant on a fresh installation",()=>{
    expect(plugin.releaseStatus).toBe("INCOMPLETE");
    expect(plugin.seedDefinition?.enabled).toBe(false);
    expect(plugin.seedDefinition?.initialVersion).toBe("DRAFT");
    expect(plugin.specCard).toBeNull();
  });
  it("keeps the historic method configuration available for immutable existing versions",()=>{
    expect(plugin.codeRelease?.config.targetRate).toBe("0.09");
    expect(plugin.codeRelease?.config.targetExposure).toBe("NASDAQ_100_3X_LONG");
  });
});
