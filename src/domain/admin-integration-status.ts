// Read-only labels for the Admin Integrations hub. A saved secret or enabled toggle
// is configuration evidence, never proof of a successful provider connection.
export type AdminSettingState = {key:string;source:"database"|"environment"|"unset";value:string|null};

export type IntegrationStatuses = {
  turnstile:string;
  marketData:string;
  payments:string;
  communications:string;
};

export function describeIntegrationStatuses(settings:readonly AdminSettingState[]):IntegrationStatuses {
  const entry=(key:string)=>settings.find(setting=>setting.key===key);
  const saved=(key:string)=>{const setting=entry(key);return Boolean(setting&&setting.source!=="unset");};
  const value=(key:string)=>entry(key)?.value??null;
  const turnstileEnabled=value("TURNSTILE_ENABLED")==="true";
  const turnstileKeys=saved("TURNSTILE_SITE_KEY")&&saved("TURNSTILE_SECRET_KEY");

  return {
    turnstile:!turnstileKeys
      ?(turnstileEnabled?"Enabled · keys missing":"Needs setup")
      :(turnstileEnabled?"Enabled · unverified":"Keys saved · disabled"),
    marketData:value("MARKET_DATA_MODE")==="MANUAL"
      ?"Manual mode"
      :value("MARKET_DATA_PROVIDER")==="yahoo"
        ?"Unofficial feed"
        :(saved("MARKET_DATA_HTTP_BASE_URL")&&saved("MARKET_DATA_HTTP_TOKEN")?"Credentials saved":"Needs setup"),
    payments:saved("STRIPE_SECRET_KEY")&&saved("STRIPE_WEBHOOK_SECRET")?"Credentials saved":"Needs setup",
    communications:value("EMAIL_PROVIDER")==="mock"
      ?"Mock mode · no delivery"
      :(saved("EMAIL_HTTP_ENDPOINT")&&saved("EMAIL_HTTP_TOKEN")?"Credentials saved":"Needs setup")
  };
}
