import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

describe("Admin launch status wording",()=>{
 it("labels the operator checkout switch separately from readiness verification",()=>{
  for(const file of ["src/app/admin/page.tsx","src/app/admin/layout.tsx"]){
   const content=readFileSync(file,"utf8");
   expect(content).toContain('launchLocked?"Pre-launch":"Checkout switch on"');
   expect(content).not.toContain('"Launch enabled"');
   expect(content).not.toContain('"Paid launch enabled"');
  }
 });
});
