import { requirePageUser } from "@/lib/session";
import { sql } from "@/lib/db";
import { BillingButtons,DiscordForm,TelegramForm,PrivacyControls,SecurityControls } from "@/components/SettingsForms";
import { isMfaEnabled } from "@/lib/mfa";
import { loadEntitlements } from "@/lib/entitlement-service";
import { purchasesAllowedFor } from "@/domain/native-app";
import { StorePurchase } from "@/components/StorePurchase";
import { manageSubscriptionUrl,platformFromUserAgent,productsForPlatform,storeName } from "@/domain/store-products";
import { headers } from "next/headers";

export default async function SettingsPage(){
  const user=await requirePageUser();
  const [mfaEnabled,entitlements]=await Promise.all([isMfaEnabled(user.id),loadEntitlements(user.id)]);
  const userAgent=(await headers()).get("user-agent");
  const canPurchase=purchasesAllowedFor(userAgent);
  const platform=platformFromUserAgent(userAgent);
  const rows=await sql.unsafe(
    "SELECT p.display_name,p.slug,p.max_active_strategies,s.status,s.cadence,s.current_period_end,s.stripe_subscription_id,s.source FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.user_id=$1 LIMIT 1",
    [user.id]
  );
  const plan=rows[0];
  const activeRows=await sql.unsafe("SELECT count(*)::int AS count FROM strategy_instances WHERE user_id=$1 AND status='ACTIVE'",[user.id]);
  const activeStrategyCount=Number(activeRows[0]?.count??0);
  const priceRows=await sql.unsafe(
    "SELECT p.slug,p.display_name,p.max_active_strategies,p.entitlements,pp.currency,pp.cadence,pp.amount_minor FROM plan_prices pp JOIN plans p ON p.id=pp.plan_id WHERE pp.active=true AND p.visible=true AND p.archived=false AND p.slug<>'free' ORDER BY p.sort_order,pp.currency,pp.cadence"
  );
  const prices=priceRows.map((p:any)=>({
    planSlug:String(p.slug),
    planName:String(p.display_name),
    currency:String(p.currency),
    cadence:String(p.cadence) as "MONTHLY"|"ANNUAL",
    amountMinor:Number(p.amount_minor),
    maxActiveStrategies:p.max_active_strategies==null?null:Number(p.max_active_strategies),
    entitlements:(p.entitlements??{}) as Record<string,unknown>
  }));
  const billedBy=String(plan?.source??"STRIPE");
  const storeBilled=billedBy!=="STRIPE"&&!["FREE","CANCELED"].includes(String(plan?.status??"FREE"));
  const storeKey=platform==="ios"?process.env.REVENUECAT_APPLE_PUBLIC_KEY:platform==="android"?process.env.REVENUECAT_GOOGLE_PUBLIC_KEY:undefined;
  const storeProducts=platform&&storeKey?productsForPlatform(
    (await sql.unsafe("SELECT p.slug,p.display_name,pp.cadence,pp.apple_product_id,pp.google_product_id FROM plan_prices pp JOIN plans p ON p.id=pp.plan_id WHERE pp.active=true AND p.visible=true AND p.archived=false AND p.slug<>'free' ORDER BY p.sort_order,pp.cadence")) as any,
    platform
  ):[];
  const currentPlanSlug=String(plan?.slug??"free");
  const currentStatus=String(plan?.status??"FREE");
  const telegram=await sql.unsafe("SELECT enabled FROM notification_endpoints WHERE user_id=$1 AND channel='TELEGRAM' LIMIT 1",[user.id]);
  const telegramConnected=Boolean(telegram[0]?.enabled);
  const paidSubscription=Boolean(plan?.stripe_subscription_id)&&!["FREE","CANCELED"].includes(currentStatus);

  return <>
    <div className="page-title"><div><div className="eyebrow">Settings</div><h1>Keep it simple.</h1><p>Your plan, notifications, privacy and account data live here.</p></div></div>
    <div className="detail-grid settings-grid">
      <section id="plan" className="glass form-card settings-plan-card">
        <div className="settings-card-heading"><div><div className="eyebrow">Plan</div><h3>{plan?.display_name??"Free"}</h3></div><span className="pill good">{currentStatus.replaceAll("_"," ")}</span></div>
        {plan?.current_period_end&&paidSubscription&&<p className="help">Current billing period runs to {new Date(plan.current_period_end).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})}.</p>}
        {storeBilled&&<p className="help">Your subscription is billed through the {storeName(billedBy)}. Change or cancel it there{platform?<> (<a href={manageSubscriptionUrl(platform)} target="_blank" rel="noreferrer">manage subscription</a>)</>:null}.</p>}
        {!storeBilled&&!canPurchase&&platform&&storeKey&&storeProducts.length>0&&!paidSubscription?<StorePurchase apiKey={storeKey} userId={user.id} products={storeProducts} currentPlanSlug={currentPlanSlug} manageUrl={manageSubscriptionUrl(platform)}/>:null}
        {!storeBilled&&canPurchase?<BillingButtons prices={prices} defaultCurrency={user.baseCurrency} currentPlanSlug={currentPlanSlug} paidSubscription={paidSubscription} activeStrategyCount={activeStrategyCount} currentMaxActiveStrategies={plan?.max_active_strategies==null?null:Number(plan.max_active_strategies)}/>:null}
        {!storeBilled&&!canPurchase&&!(platform&&storeKey&&storeProducts.length>0&&!paidSubscription)&&<p className="help">{paidSubscription?"Your subscription is billed through the website. Sign in there to change or cancel it.":"Plans are managed on the website. Sign in there to subscribe, change or cancel."}</p>}
      </section>
      <section className="glass form-card">
        <div className="eyebrow">Notifications</div><h3>Discord</h3>
        <p className="help">Add an encrypted Discord webhook if your current plan includes Discord alerts.</p>
        <DiscordForm/>
      </section>
      <section className="glass form-card">
        <div className="eyebrow">Notifications</div><h3>Telegram</h3>
        <p className="help">Connect privately to the Wealtharr bot with a one-time 15-minute link. You never need to enter your Telegram chat ID.</p>
        <TelegramForm connected={telegramConnected} allowed={entitlements.notificationChannels.has("TELEGRAM")}/>
      </section>
    </div>
    <section id="security" className="card privacy-card"><div className="eyebrow">Security</div><h3>Two-step sign-in</h3><SecurityControls enabled={mfaEnabled}/></section>
    <section className="card privacy-card"><div className="eyebrow">Privacy</div><h3>Your data, your choice.</h3><p className="help">Anonymous community aggregates use privacy-thresholded derived data only. You can opt out, export your data, or close the account.</p><PrivacyControls optIn={user.anonymousAggregateOptIn}/></section>
  </>;
}
