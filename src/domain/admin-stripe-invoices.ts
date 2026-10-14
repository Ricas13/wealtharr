/** Read-only Stripe invoice history ownership and display helpers. */
export function verifiedInvoiceSubscriptionOwner(input:{
  userId:string;customerId:string;subscriptionId:string;
  remoteCustomerId:string|null;remoteSubscriptionId:string;remoteMetadataUserId:string|null;
}):boolean{
 return Boolean(input.userId&&input.customerId&&input.subscriptionId&&
  input.remoteCustomerId===input.customerId&&
  input.remoteSubscriptionId===input.subscriptionId&&
  (!input.remoteMetadataUserId||input.remoteMetadataUserId===input.userId));
}
/** Shared ISO minor-unit display, retained under the existing invoice helper name. */
export {formatMinorCurrency as invoiceAmountMinor} from "@/domain/currency-money";
