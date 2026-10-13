// Billing provider errors may contain private URLs, customer details or secrets.
// Only deliberately narrow, machine-readable error codes belong in Admin UI.
export function safeBillingErrorCode(raw:unknown):string {
  if(typeof raw!=="string"||!raw)return "No safe code recorded";
  if(!/^[A-Z][A-Z0-9_]{2,63}$/.test(raw))return "Details withheld — inspect protected server logs";
  return raw;
}
