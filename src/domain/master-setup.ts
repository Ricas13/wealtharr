/**
 * Setup status is a navigation aid, not proof that a third-party service works
 * or that an investment strategy is legally/commercially verified.
 */
export type SetupSignal = {
  id: string; title: string; detail: string; href: string;
  status: "configured" | "needs-setup" | "requires-verification";
};
export type MasterSetupInputs = {
  publicUrl: boolean; brand: boolean; mfa: boolean; stripe: boolean;
  email: boolean; market: boolean; notifications: boolean;
  indexing: boolean; plans: number; publishedStrategies: number;
  approvedMappings: number; lastCronAt: Date | null;
  backupAt: Date | null; backupExpected: boolean;
  attestations: boolean; now: Date;
};
export function masterSetupSignals(input: MasterSetupInputs): SetupSignal[] {
  const status=(ok:boolean):SetupSignal["status"]=>ok?"configured":"needs-setup";
  const recent=(date:Date|null,hours:number)=>date!==null&&Number.isFinite(date.getTime())&&
    date.getTime()<=input.now.getTime()&&input.now.getTime()-date.getTime()<=hours*3_600_000;
  return [
    {id:"site",title:"Site address and identity",status:status(input.publicUrl&&input.brand),
      detail:"Set the public URL, product name and indexing preference.",href:"/admin/settings#settings-general"},
    {id:"security",title:"Administrator security",status:status(input.mfa),
      detail:"Require two-step sign-in and keep bootstrap secrets in Docker Compose.",href:"/admin/settings#settings-security"},
    {id:"stripe",title:"Stripe payments",status:status(input.stripe),
      detail:"Configure encrypted keys and webhook secret, then test a real checkout in staging.",href:"/admin/settings#settings-billing-stripe-"},
    {id:"email",title:"Transactional email",status:status(input.email),
      detail:"Configure the outbound provider and send a test message.",href:"/admin/settings#settings-email"},
    {id:"market",title:"Market price and history provider",status:status(input.market),
      detail:"Provider credentials here; commercial rights, adjusted history and FX require separate validation.",href:"/admin/settings#settings-market-data"},
    {id:"plans",title:"Plans, prices and entitlements",status:status(input.plans>0),
      detail:"Set strategy limits, subscriptions, billing currencies and notification channels.",href:"/admin/plans"},
    {id:"catalogue",title:"Curated strategies",status:input.publishedStrategies>0?"requires-verification":"needs-setup",
      detail:"Publish only source-verified, fixed-rule strategies. This step never certifies algorithms.",href:"/admin/strategies"},
    {id:"instruments",title:"Regional instruments",status:input.approvedMappings>0?"requires-verification":"needs-setup",
      detail:"Verify each market, wrapper, broker, exact exposure and purchasing eligibility.",href:"/admin/instruments"},
    {id:"notifications",title:"Notification delivery",status:status(input.notifications&&input.email),
      detail:"Configure email, Discord and Telegram; register the Telegram webhook and inspect delivery retries.",href:"/admin/settings#settings-messaging-telegram-"},
    {id:"workers",title:"Automated monitoring",status:status(recent(input.lastCronAt,2)),
      detail:"Verify successful hourly scheduler runs and recalculated portfolio actions.",href:"/admin/operations"},
    {id:"backup",title:"Backup and restore",status:input.backupExpected&&recent(input.backupAt,36)?"requires-verification":"needs-setup",
      detail:"Enable the Docker backup service; heartbeat is not a substitute for a tested restore.",href:"/admin/launch"},
    {id:"seo",title:"Search visibility",status:status(input.indexing),
      detail:"Enable indexing only after domain, legal content and public pages are verified.",href:"/admin/seo"},
    {id:"launch",title:"Commercial release sign-offs",status:input.attestations?"requires-verification":"needs-setup",
      detail:"Regulatory advice, actual provider licensing and restore evidence need independent verification.",href:"/admin/launch"}
  ];
}
