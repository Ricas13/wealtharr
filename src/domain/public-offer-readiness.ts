import {paidCheckoutBlockers} from "@/domain/commercial-launch";

/** A schema.org Offer is an availability claim, not just a displayed plan price.
 * Never advertise paid live checkout from staging, test keys or an unset launch switch.
 */
export function canAdvertisePaidOffer(env:Record<string,string|undefined>):boolean{
 return env.WEALTHARR_PAID_LAUNCH_ENABLED==="true"&&
  /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY??"")&&
  paidCheckoutBlockers(env).length===0;
}
