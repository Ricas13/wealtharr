import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

describe("Admin provider test audit panel",()=>{
 it("only reads approved test metadata and does not expose raw provider diagnostics",()=>{
  const page=readFileSync("src/app/admin/security/page.tsx","utf8");
  expect(page).toContain("integration.connection-test");
  expect(page).toContain("metadata->>'service'");
  expect(page).toContain("metadata->>'ok'");
  expect(page).toContain("LIMIT 12");
  expect(page).toContain("Recent integration tests");
  expect(page).not.toContain("metadata->>'token'");
  expect(page).not.toContain("metadata->>'response'");
  expect(page).toContain("It does not verify customer payment flows");
 });
});
