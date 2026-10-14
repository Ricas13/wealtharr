import {describe,it,expect} from "vitest";
import Decimal from "decimal.js";
const D=(n:number|string)=>new Decimal(n);
import {trend200Decision} from "../src/domain/strategy/tactical-math";
describe("trend-200d canonical golden",()=>{
 it("uses 200 sessions including signal day; last close 200 gives SMA 100.5",()=>{
 const p=Array.from({length:200},(_,i)=>({at:new Date(Date.UTC(2025,0,i+1)),adjustedClose:D(i===199?200:100)}));
 expect(trend200Decision(p,new Date("2025-09-01")).average).toBe("100.5");
 expect(trend200Decision(p,new Date("2025-09-01")).invested).toBe(true);
 expect(trend200Decision(p.map(x=>({...x,adjustedClose:D(100)})),new Date("2025-09-01")).invested).toBe(false);
 });
});
