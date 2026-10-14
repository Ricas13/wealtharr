/** A stale or cross-linked Stripe identifier must never open another account's billing portal. */
export type PortalOwnership={
  userId:string;
  localCustomerId:string;
  remoteCustomerId:string|null;
  remoteCustomerMetadataUserId:string|null;
  localSubscriptionId:string|null;
  remoteSubscriptionId:string|null;
  remoteSubscriptionCustomerId:string|null;
  remoteSubscriptionMetadataUserId:string|null;
};
export function mayOpenStripeBillingPortal(input:PortalOwnership):boolean{
 if(!input.userId||!input.localCustomerId||input.localCustomerId!==input.remoteCustomerId)return false;
 if(input.remoteCustomerMetadataUserId&&input.remoteCustomerMetadataUserId!==input.userId)return false;
 if(input.localSubscriptionId!==null){
  if(input.remoteSubscriptionId!==input.localSubscriptionId||
     input.remoteSubscriptionCustomerId!==input.localCustomerId)return false;
  if(input.remoteSubscriptionMetadataUserId&&input.remoteSubscriptionMetadataUserId!==input.userId)return false;
 }
 return true;
}
