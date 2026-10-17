import type Stripe from "stripe";
import type {SubscriptionIdentity} from "@/lib/stripe-subscription-state";

type Reference=SubscriptionIdentity;
type StripeRef=string|{id?:string}|null|undefined;
const refId=(ref:StripeRef):string|null=>{
 const id=typeof ref==="string"?ref:ref?.id;
 return typeof id==="string"&&id.startsWith("sub_")&&id.length>4?id:null;
};
const customerId=(ref:StripeRef):string|null=>{
 const id=typeof ref==="string"?ref:ref?.id;
 return typeof id==="string"&&id.startsWith("cus_")&&id.length>4?id:null;
};

/**
 * Stripe's subscription lifecycle events do not always arrive in order.
 * This extracts only canonical subscription references; all changes are
 * subsequently checked against Stripe and the local customer mapping.
 * Invoice.subscription was moved to parent.subscription_details.subscription
 * in newer Stripe API versions. Both formats are accepted.
 */
export function subscriptionReferenceFromEvent(event:Pick<Stripe.Event,"type"|"data">):Reference|null{
 const raw=event.data.object as unknown as Record<string,unknown>;
 if(!raw||typeof raw!=="object")return null;
 let id:string|null=null;
 if(event.type.startsWith("customer.subscription.")){
   id=refId(raw.id as StripeRef);
 }else if(event.type==="checkout.session.completed"||
   event.type==="checkout.session.async_payment_succeeded"||
   event.type==="checkout.session.async_payment_failed"){
   if(raw.mode!=="subscription")return null;
   id=refId(raw.subscription as StripeRef);
 }else if(event.type==="invoice.paid"||
   event.type==="invoice.payment_failed"||
   event.type==="invoice.payment_action_required"||
   event.type==="invoice.marked_uncollectible"){
   const parent=raw.parent as {subscription_details?:{subscription?:StripeRef}}|undefined;
   id=refId(parent?.subscription_details?.subscription??raw.subscription as StripeRef);
 }
 if(!id)return null;
 const customer=customerId(raw.customer as StripeRef);
 if(!customer)return null;
 return {id,customer,metadata:{}};
}
