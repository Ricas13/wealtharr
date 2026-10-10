import {describe,it,expect} from "vitest";
import {validatedFillTime} from "@/domain/execution-time";
const now=new Date("2026-10-09T15:00:00Z");
const action=new Date("2026-10-09T14:00:00Z");
describe("broker fill timestamp fidelity",()=>{
 it("defaults to the actual confirmation time if no earlier broker time supplied",()=>{
   expect(validatedFillTime(undefined,action,null,now).toISOString()).toBe(now.toISOString());
 });
 it("preserves the real broker timestamp and correctly interprets explicit timezone offsets",()=>{
   expect(validatedFillTime("2026-10-09T15:30:00+01:00",action,null,now).toISOString())
     .toBe("2026-10-09T14:30:00.000Z");
 });
 it("rejects future, malformed and implausibly old timestamps",()=>{
   for(const raw of ["bad","2026-10-10T15:00:00Z","1980-01-01T00:00:00Z"]){
     expect(()=>validatedFillTime(raw,action,null,now)).toThrow("INVALID_EXECUTION_TIMESTAMP");
   }
 });
 it("refuses a fill predating the instruction or last transaction",()=>{
   expect(()=>validatedFillTime("2026-10-09T13:00:00Z",action,null,now)).toThrow("EXECUTION_BEFORE_ACTION");
   expect(()=>validatedFillTime("2026-10-09T14:20:00Z",action,new Date("2026-10-09T14:40:00Z"),now))
     .toThrow("EXECUTION_OUT_OF_ORDER");
 });
 it("does not reject a valid delayed confirmation after the previous ledger event",()=>{
   expect(validatedFillTime("2026-10-09T14:45:00Z",action,new Date("2026-10-09T14:30:00Z"),now).toISOString())
     .toBe("2026-10-09T14:45:00.000Z");
 });
});
