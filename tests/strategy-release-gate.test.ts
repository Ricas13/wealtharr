import {describe,expect,it,vi} from "vitest";
import {assertDisabledStrategyPreviewGates} from "@/lib/admin-preview-gates";
import {CANONICAL_9SIG_CONFIG} from "@/domain/strategy/catalog";

const version={key:"9sig",enabled:true,version_id:"test-version",engine_key:"VALUE_TARGET",
  config:CANONICAL_9SIG_CONFIG,input_schema:[]};
const db=(accepted:boolean)=>({unsafe:vi.fn(async()=>accepted?[{approved:true}]:[])}) as never;

describe("new strategy start/switch release gate",()=>{
  it("permits a canonical enabled release without operator sign-off",async()=>{
    const client=db(false);
    await expect(assertDisabledStrategyPreviewGates(client,version)).resolves.toBeUndefined();
  });
  it("allows an admin preview of valid code without manual review",async()=>{
    await expect(assertDisabledStrategyPreviewGates(db(false),{...version,enabled:false})).resolves.toBeUndefined();
  });
  it("accepts canonical code rules independently of audit records",async()=>{
    await expect(assertDisabledStrategyPreviewGates(db(true),version)).resolves.toBeUndefined();
    await expect(assertDisabledStrategyPreviewGates(db(true),{...version,enabled:false})).resolves.toBeUndefined();
  });
  it("refuses unreviewed source-rule changes even when evidence exists",async()=>{
    await expect(assertDisabledStrategyPreviewGates(db(true),{...version,
      config:{...CANONICAL_9SIG_CONFIG,targetRate:"0.12"}})).rejects.toThrow("CURATED_STRATEGY_RULES_IMMUTABLE");
  });
  it("refuses an unknown research stub even with a forged evidence row",async()=>{
    await expect(assertDisabledStrategyPreviewGates(db(true),{...version,key:"research-stub"})).rejects.toThrow("CURATED_STRATEGY_NOT_VERIFIED");
  });
});
