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
/** Stripe invoice amounts use the ISO minor unit for their billing currency. */
export function invoiceAmountMinor(minor:number,currency:string):string{
 try{
  if(!Number.isSafeInteger(minor))throw new Error("INVALID_AMOUNT");
  const code=currency.toUpperCase();
  const fmt=new Intl.NumberFormat("en-GB",{style:"currency",currency:code});
  const digits=fmt.resolvedOptions().maximumFractionDigits??2;
  return fmt.format(minor/10**digits);
 }catch{
  return String(minor)+" "+currency.toUpperCase()+" minor units";
 }
}
