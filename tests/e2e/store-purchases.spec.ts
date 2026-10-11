import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const PASSWORD="e2e-password-1234";
const IOS_APP_UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WealtharrApp";
const PRODUCT="com.e2e.pro.monthly";

function db(){
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("DATABASE_URL is required for authenticated e2e tests");
  return postgres(url,{max:1,prepare:false});
}
async function makeUser(label:string,role="USER"){
  const email=`e2e-store-${label}@example.test`;
  const sql=db();
  try{
    await sql.begin(async(tx)=>{
      await tx.unsafe("DELETE FROM users WHERE email=$1",[email]);
      const free=await tx.unsafe("SELECT id FROM plans WHERE slug='free' LIMIT 1");
      const u=await tx.unsafe("INSERT INTO users (email,password_hash,email_verified_at,role) VALUES ($1,$2,now(),$3) RETURNING id",[email,await bcrypt.hash(PASSWORD,4),role]);
      await tx.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'FREE','FREE')",[u[0].id,free[0].id]);
    });
  }finally{await sql.end();}
  return email;
}
async function signIn(page:import("@playwright/test").Page,email:string){
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button",{name:"Sign in"}).click();
  await page.waitForURL("**/app");
}

test("in the iOS app a free user sees the in-app purchase area, never website checkout; website users billed by Apple are pointed to the store",async({page,browser},testInfo)=>{
  test.skip(testInfo.project.name!=="desktop-chromium","settings and prices are global; one project mutates them");
  const sql=db();
  const priorProVisibility=await sql.unsafe("SELECT visible FROM plans WHERE slug='pro'");
  try{
    // Fresh installations intentionally publish zero plans; make this test plan
    // explicitly available to verify the actual native checkout path.
    await sql.unsafe("UPDATE plans SET visible=true WHERE slug='pro'");
    // Operator: save the iOS public SDK key in the admin screen and map a store product to a price.
    const adminEmail=await makeUser("admin","ADMIN");
    await signIn(page,adminEmail);
    const origin=new URL(page.url()).origin;
    const saved=await page.request.put("/api/admin/settings",{headers:{origin,"content-type":"application/json"},data:{changes:[{key:"REVENUECAT_APPLE_PUBLIC_KEY",value:"appl_e2eTestKey1234567"}]}});
    expect(saved.status()).toBe(200);
    await sql.unsafe("UPDATE plan_prices SET apple_product_id=$1 WHERE plan_id=(SELECT id FROM plans WHERE slug='pro') AND currency='GBP' AND cadence='MONTHLY'",[PRODUCT]);

    // A free customer inside the iOS app.
    const appUser=await makeUser("appuser");
    const appContext=await browser.newContext({userAgent:IOS_APP_UA,baseURL:origin});
    const appPage=await appContext.newPage();
    await signIn(appPage,appUser);
    await appPage.goto("/app/settings");
    await expect(appPage.getByText("Open this page inside the app to subscribe.")).toBeVisible();
    await expect(appPage.getByRole("button",{name:/subscribe|upgrade|checkout/i})).toHaveCount(0);
    const checkout=await appPage.request.post("/api/billing/checkout",{headers:{origin,"content-type":"application/json"},data:{planSlug:"pro",cadence:"monthly"}});
    expect(checkout.status()).toBe(403);
    await appContext.close();

    // The same kind of customer on the website, once billed by Apple, is told where to manage it.
    const billed=await makeUser("billed");
    await sql.unsafe("UPDATE subscriptions SET plan_id=(SELECT id FROM plans WHERE slug='pro'),status='ACTIVE',cadence='MONTHLY',source='APPLE',store_original_transaction_id='txn_e2e_billed' WHERE user_id=(SELECT id FROM users WHERE email=$1)",[billed]);
    const webContext=await browser.newContext({baseURL:origin});
    const webPage=await webContext.newPage();
    await signIn(webPage,billed);
    await webPage.goto("/app/settings");
    await expect(webPage.getByText(/billed through the App Store/)).toBeVisible();
    await expect(webPage.getByRole("button",{name:/subscribe|upgrade/i})).toHaveCount(0);
    await webContext.close();
  }finally{
    await sql.unsafe("DELETE FROM app_settings WHERE key='REVENUECAT_APPLE_PUBLIC_KEY'");
    await sql.unsafe("UPDATE plan_prices SET apple_product_id=NULL WHERE apple_product_id=$1",[PRODUCT]);
    await sql.unsafe("UPDATE plans SET visible=$1 WHERE slug='pro'",[Boolean(priorProVisibility[0]?.visible)]);
    await sql.end();
  }
});
