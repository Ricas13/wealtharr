import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
const D=(n:number|string)=>new Decimal(n);
import {classicGemDecision} from "../src/domain/strategy/tactical-math";
const monthly=(end:number)=>Array.from({length:13},(_,i)=>D(100+(end-100)*i/12));
describe("dual-momentum canonical golden",()=>{
 it("US +8%, ex-US +20%, bills +2% chooses ex-US",()=>expect(classicGemDecision({us:monthly(108),exUs:monthly(120),tbills:monthly(102),usExposure:"US",exUsExposure:"EXUS",bondExposure:"BONDS"})).toBe("EXUS"));
 it("US +1%, ex-US +30%, bills +2% must choose bonds rather than ex-US",()=>expect(classicGemDecision({us:monthly(101),exUs:monthly(130),tbills:monthly(102),usExposure:"US",exUsExposure:"EXUS",bondExposure:"BONDS"})).toBe("BONDS"));
});
