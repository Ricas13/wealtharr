import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const PASSWORD="e2e-password-1234";

async function createAdmin(testInfo:{project:{name:string};workerIndex:number}){
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("DATABASE_URL is required for authenticated e2e tests");
  const project=testInfo.project.name.replace(/[^a-z0-9]+/gi,"-").toLowerCase();
  const email=`e2e-${project}-${testInfo.workerIndex}-settings-admin@example.test`;
  const sql=postgres(url,{max:1,prepare:false});
  try{
    await sql.unsafe("DELETE FROM users WHERE email=$1",[email]);
    await sql.unsafe("INSERT INTO users (email,password_hash,email_verified_at,role) VALUES ($1,$2,now(),'ADMIN')",[email,await bcrypt.hash(PASSWORD,4)]);
  }finally{await sql.end();}
  return email;
}
async function wipeSettings(keys:string[]){
  const sql=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
  try{await sql.unsafe("DELETE FROM app_settings WHERE key=ANY($1::text[])",[keys]);}finally{await sql.end();}
}

// Settings are global, so only one browser project may change them at a time.
const onlyDesktop=(name:string)=>name==="desktop-chromium";

test("an admin manages settings in the browser; secrets are write-only",async({page},testInfo)=>{
  test.skip(!onlyDesktop(testInfo.project.name),"settings are global; one project mutates them");
  const KEYS=["GOOGLE_SITE_VERIFICATION","MARKET_DATA_HTTP_TOKEN"];
  const email=await createAdmin(testInfo);
  await wipeSettings(KEYS);
  try{
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button",{name:"Sign in"}).click();
    await page.waitForURL("**/app");

    await page.goto("/admin/settings");
    await expect(page.getByRole("heading",{name:"Settings",exact:true})).toBeVisible();
    await expect(page.getByText("Still in the server environment")).toBeVisible();
    await expect(page.getByRole("heading",{name:"Cloudflare Turnstile"})).toBeVisible();
    await expect(page.getByLabel("Cloudflare site key")).toBeVisible();
    await expect(page.getByLabel("Cloudflare secret key")).toHaveAttribute("type","password");
    await expect(page.getByRole("button",{name:"Test connection"})).toBeVisible();

    // An ordinary setting: saved, shown back, and applied to the public site without a restart.
    await page.getByLabel(/Google Search Console token/).fill("e2e-verification-token");
    await page.getByLabel(/Market data token/).fill("super-secret-e2e-token-value");
    await page.getByRole("button",{name:/Save 2 changes/}).click();
    await expect(page.getByText(/Saved\. Changes apply/)).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/Google Search Console token/)).toHaveValue("e2e-verification-token");
    // The secret is never sent back to the browser: not in a field, not anywhere in the page.
    await expect(page.getByLabel(/Market data token/)).toHaveValue("");
    expect(await page.content()).not.toContain("super-secret-e2e-token-value");

    const home=await page.request.get("/");
    expect(await home.text()).toContain("e2e-verification-token");

    // Removing a saved value falls back to the environment (here: nothing).
    await page.getByLabel(/Google Search Console token/).fill("");
    await page.getByRole("button",{name:"Remove saved value"}).click();
    await page.getByRole("button",{name:/Save 2 changes/}).click();
    await expect(page.getByText(/Saved\. Changes apply/)).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/Google Search Console token/)).toHaveValue("");
    expect(await (await page.request.get("/")).text()).not.toContain("e2e-verification-token");
  }finally{
    await wipeSettings(KEYS);
  }
});

test("a bad value is explained and nothing is saved",async({page},testInfo)=>{
  test.skip(!onlyDesktop(testInfo.project.name),"settings are global; one project mutates them");
  const email=await createAdmin(testInfo);
  await wipeSettings(["CRON_CONCURRENCY"]);
  try{
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button",{name:"Sign in"}).click();
    await page.waitForURL("**/app");
    await page.goto("/admin/settings");
    await page.getByLabel(/Job concurrency/).fill("500");
    await page.getByRole("button",{name:/Save 1 change/}).click();
    await expect(page.getByText("Must be at most 32.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/Job concurrency/)).toHaveValue("");
  }finally{
    await wipeSettings(["CRON_CONCURRENCY"]);
  }
});

test("setup is closed once an administrator exists",async({page},testInfo)=>{
  await createAdmin(testInfo);
  await page.goto("/setup");
  await page.waitForURL("**/login");
});
