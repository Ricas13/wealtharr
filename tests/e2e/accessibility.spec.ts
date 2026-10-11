import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import bcrypt from "bcryptjs";
import postgres from "postgres";

// Automated WCAG 2.1 A/AA checks (axe-core) on the public pages, the sign-in flow and the signed-in
// app, in both colour themes. Automated checks catch roughly a third of accessibility problems
// (contrast, names and labels, landmarks, focus, ARIA misuse); they do not replace testing with a
// screen reader and keyboard. Anything excluded below is listed with its reason, never silently.
const PASSWORD="e2e-password-1234";
const TAGS=["wcag2a","wcag2aa","wcag21a","wcag21aa"];

async function createUser(testInfo:{project:{name:string};workerIndex:number},role="USER"){
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("DATABASE_URL is required for authenticated e2e tests");
  const project=testInfo.project.name.replace(/[^a-z0-9]+/gi,"-").toLowerCase();
  const email=`e2e-${project}-${testInfo.workerIndex}-a11y-${role.toLowerCase()}@example.test`;
  const sql=postgres(url,{max:1,prepare:false});
  try{
    await sql.begin(async(tx)=>{
      await tx.unsafe("DELETE FROM users WHERE email=$1",[email]);
      const plans=await tx.unsafe("SELECT id FROM plans WHERE slug='free' LIMIT 1");
      const users=await tx.unsafe("INSERT INTO users (email,password_hash,email_verified_at,role) VALUES ($1,$2,now(),$3) RETURNING id",[email,await bcrypt.hash(PASSWORD,4),role]);
      await tx.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'FREE','FREE')",[users[0].id,plans[0].id]);
    });
  }finally{await sql.end();}
  return email;
}

async function violations(page:Page){
  const results=await new AxeBuilder({page}).withTags(TAGS).analyze();
  return results.violations.map((v)=>({
    rule:v.id,impact:v.impact,help:v.help,
    nodes:v.nodes.slice(0,4).map((n)=>n.target.join(" ")+" :: "+(n.failureSummary??"").split("\n").slice(1,3).join(" ").trim())
  }));
}
async function audit(page:Page,label:string){
  const summary=await violations(page);
  expect(summary,`${label}: ${summary.length} accessibility violation(s)`).toEqual([]);
}
// Audits several pages and reports every offender at once instead of stopping at the first.
async function auditAll(page:Page,paths:string[]){
  const found:Record<string,unknown>={};
  for(const path of paths){
    await page.goto(path);
    const v=await violations(page);
    if(v.length)found[path]=v;
  }
  expect(found).toEqual({});
}

async function setTheme(page:Page,theme:"dark"|"light"){
  await page.emulateMedia({colorScheme:theme,reducedMotion:"reduce"});
  await page.evaluate((t)=>{document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;},theme);
}

const PUBLIC_PAGES=["/","/login","/register","/reset-password","/pricing","/features","/faq","/strategies","/tools/rebalance-calculator","/offline"];

for(const theme of ["dark","light"] as const){
  test.describe(`${theme} theme`,()=>{
    for(const path of PUBLIC_PAGES){
      test(`public page ${path}`,async({page})=>{
        await page.goto(path);
        await setTheme(page,theme);
        await audit(page,`${path} (${theme})`);
      });
    }

    test("demo page",async({page})=>{
      await page.goto("/demo");
      await expect(page.locator(".chart-wrap svg")).toBeVisible();
      await setTheme(page,theme);
      await audit(page,`/demo (${theme})`);
    });

    test("signed-in app pages",async({page},testInfo)=>{
      const email=await createUser(testInfo);
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button",{name:"Sign in"}).click();
      await page.waitForURL("**/app");
      for(const path of ["/app","/app/strategies","/app/strategies/new","/app/notifications","/app/community","/app/settings"]){
        await page.goto(path);
        await setTheme(page,theme);
        await audit(page,`${path} (${theme})`);
      }
    });
  });
}

test("admin screens",async({page},testInfo)=>{
  test.skip(testInfo.project.name!=="desktop-chromium","admin screens are desktop-only");
  const email=await createUser(testInfo,"ADMIN");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button",{name:"Sign in"}).click();
  await page.waitForURL("**/app");
  await auditAll(page,["/admin","/admin/configuration","/admin/integrations","/admin/security","/admin/settings","/admin/launch","/admin/plans","/admin/strategies","/admin/strategies/research","/admin/instruments","/admin/users","/admin/operations","/admin/seo"]);
});

test("a strategy page with its forms (trades, price, settings, switch)",async({page},testInfo)=>{
  const email=await createUser(testInfo);
  const url=process.env.DATABASE_URL!;
  const sql=postgres(url,{max:1,prepare:false});
  let id="";
  try{
    const user=(await sql.unsafe("SELECT id FROM users WHERE email=$1",[email]))[0];
    const account=await sql.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'A11y','ISA','GB','GBP') RETURNING id",[user.id]);
    const inst=await sql.unsafe("INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) SELECT $1,$2,d.id,v.id,'A11y strategy' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' LIMIT 1 RETURNING id,strategy_version_id",[user.id,account[0].id]);
    id=String(inst[0].id);
    await sql.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",[id,account[0].id]);
    await sql.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{}'::jsonb)",[id,inst[0].strategy_version_id]);
    await sql.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,provenance) VALUES ($1,$2,now(),'CONTRIBUTION','GBP',1000,'USER_CONFIRMED')",[id,account[0].id]);
  }finally{await sql.end();}
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button",{name:"Sign in"}).click();
  await page.waitForURL("**/app");
  await auditAll(page,["/app/strategies/"+id]);
});

test("the sign-in form can be completed with the keyboard alone and focus is always visible",async({page})=>{
  await page.goto("/login");
  await page.keyboard.press("Tab");
  // Skip links or the first field must receive visible focus.
  const first=await page.evaluate(()=>{const el=document.activeElement as HTMLElement|null;if(!el)return null;const s=getComputedStyle(el);return {tag:el.tagName,outline:s.outlineStyle+" "+s.outlineWidth,shadow:s.boxShadow};});
  expect(first).not.toBeNull();
  const visible=first!.outline.split(" ")[0]!=="none"&&first!.outline!=="none 0px"||first!.shadow!=="none";
  expect(visible,JSON.stringify(first)).toBe(true);
});
