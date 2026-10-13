import {describe,expect,it} from "vitest";
import {safeBillingErrorCode} from "@/domain/billing-event-diagnostics";

describe("billing diagnostic redaction",()=>{
 it("shows short machine-readable codes, never raw provider text",()=>{
  expect(safeBillingErrorCode("STRIPE_CUSTOMER_MISSING")).toBe("STRIPE_CUSTOMER_MISMATCH");
  expect(safeBillingErrorCode("WEBHOOK_FAILED")).toBe("WEBHOOK_FAILED");
  expect(safeBillingErrorCode("UNKNOWN_SECRET_LIKE_CODE")).toBe("Details withheld — inspect protected server logs");
  expect(safeBillingErrorCode("stripe failed: https://example.com/?token=secret")).toBe("Details withheld — inspect protected server logs");
  expect(safeBillingErrorCode("STRIPE_KEY_SK_LIVE_"+"X".repeat(80))).toBe("Details withheld — inspect protected server logs");
  expect(safeBillingErrorCode("ERROR\nAPI_KEY=secret")).toBe("Details withheld — inspect protected server logs");
 });
 it("treats missing codes as unrecorded and never stringifies unknown objects",()=>{
  expect(safeBillingErrorCode(null)).toBe("No safe code recorded");
  expect(safeBillingErrorCode("")).toBe("No safe code recorded");
  expect(safeBillingErrorCode({secret:"private"})).toBe("No safe code recorded");
 });
});
