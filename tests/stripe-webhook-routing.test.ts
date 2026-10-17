import {describe,expect,it} from "vitest";
import {subscriptionReferenceFromEvent} from "@/domain/stripe-webhook-routing";
import type Stripe from "stripe";
const event=(type:string,object:Record<string,unknown>)=>
 ({type,data:{object}}) as unknown as Pick<Stripe.Event,"type"|"data">;
describe("Stripe paid lifecycle event routing",()=>{
 const expected={id:"sub_test123",customer:"cus_test123",metadata:{}};
 it("routes subscription events by canonical Stripe references only",()=>{
  expect(subscriptionReferenceFromEvent(event("customer.subscription.created",{
   id:"sub_test123",customer:"cus_test123",metadata:{userId:"attacker"}}))).toEqual(expected);
 });
 it("routes checkout completions and delayed payment outcomes",()=>{
  for(const type of ["checkout.session.completed","checkout.session.async_payment_succeeded","checkout.session.async_payment_failed"]){
   expect(subscriptionReferenceFromEvent(event(type,{mode:"subscription",subscription:"sub_test123",customer:"cus_test123"}))).toEqual(expected);
  }
  expect(subscriptionReferenceFromEvent(event("checkout.session.completed",{mode:"payment",customer:"cus_test123",subscription:"sub_test123"}))).toBeNull();
 });
 it("handles old and new Stripe invoice subscription representations",()=>{
  for(const type of ["invoice.paid","invoice.payment_failed","invoice.payment_action_required","invoice.marked_uncollectible"]){
   expect(subscriptionReferenceFromEvent(event(type,{customer:"cus_test123",subscription:"sub_test123"}))).toEqual(expected);
   expect(subscriptionReferenceFromEvent(event(type,{customer:{id:"cus_test123"},parent:{subscription_details:{subscription:{id:"sub_test123"}}}}))).toEqual(expected);
  }
 });
 it("ignores unrelated products and malformed data without granting access",()=>{
  expect(subscriptionReferenceFromEvent(event("invoice.paid",{customer:"cus_test123",parent:{type:"invoiceitem_details"}}))).toBeNull();
  expect(subscriptionReferenceFromEvent(event("charge.succeeded",{id:"ch_test",customer:"cus_test123"}))).toBeNull();
  expect(subscriptionReferenceFromEvent(event("invoice.paid",{customer:"cus_test123",subscription:"price_wrong"}))).toBeNull();
  expect(subscriptionReferenceFromEvent(event("customer.subscription.updated",{id:"sub_test123",customer:"bad",metadata:{userId:"x"}}))).toBeNull();
 });
});
