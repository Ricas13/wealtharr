import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import postgres from "postgres";

const PASSWORD="e2e-password-1234";
const NATIVE_UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WealtharrApp";

async function createUser(testInfo:{project:{name:string};workerIndex:number}){
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("DATABASE_URL is required for authenticated e2e tests");
  const project=testInfo.project.name.replace(/[^a-z0-9]+/gi,"-").toLowerCase();
  const email=`e2e-${project}-${testInfo.workerIndex}-mobile@example.test`;
  const sql=postgres(url,{max:1,prepare:false});
  try{
    await sql.begin(async(tx)=>{
      await tx.unsafe("DELETE FROM users WHERE email=$1",[email]);
      const plans=await tx.unsafe("SELECT id FROM plans WHERE slug='free' LIMIT 1");
      const users=await tx.unsafe("INSERT INTO users (email,password_hash,email_verified_at) VALUES ($1,$2,now()) RETURNING id",[email,await bcrypt.hash(PASSWORD,4)]);
      await tx.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'FREE','FREE')",[users[0].id,plans[0].id]);
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

test.describe("installable web app",()=>{
  test("serves a valid manifest and icons that are real PNGs",async({page,request})=>{
    await page.goto("/");
    expect(await page.locator('link[rel="manifest"]').getAttribute("href")).toBe("/manifest.webmanifest");
    expect(await page.locator('meta[name="viewport"]').getAttribute("content")).toContain("viewport-fit=cover");
    expect(await page.locator('meta[name="theme-color"]').count()).toBeGreaterThan(0);
    expect(await page.locator('link[rel="apple-touch-icon"]').getAttribute("href")).toBe("/pwa-icon/180");

    const manifest=await (await request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({display:"standalone",start_url:"/app",scope:"/"});
    expect(manifest.name.length).toBeGreaterThan(0);
    const purposes=manifest.icons.map((i:{purpose:string})=>i.purpose);
    expect(purposes).toEqual(expect.arrayContaining(["any","maskable"]));
    for(const icon of manifest.icons){
      const response=await request.get(icon.src);
      expect(response.status(),icon.src).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
      const body=await response.body();
      expect(body.subarray(1,4).toString(),icon.src).toBe("PNG");
    }
    expect((await request.get("/pwa-icon/999")).status()).toBe(404);
  });

  test("ships a service worker that is never cached and an offline page",async({request})=>{
    const sw=await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["cache-control"]).toContain("no-cache");
    expect(await sw.text()).toContain("OFFLINE_URL");
    const offline=await request.get("/offline");
    expect(offline.status()).toBe(200);
    expect(await offline.text()).toContain("You are offline");
  });

  test("app link files are absent until configured",async({request})=>{
    test.skip(Boolean(process.env.ANDROID_PACKAGE_NAME||process.env.IOS_TEAM_ID),"identifiers configured in this environment");
    expect((await request.get("/.well-known/assetlinks.json")).status()).toBe(404);
    expect((await request.get("/.well-known/apple-app-site-association")).status()).toBe(404);
  });
});

test.describe("on a phone",()=>{
  test.beforeEach(({},testInfo)=>{test.skip(testInfo.project.name!=="mobile-chromium","phone layout checks");});

  test("sign-in screen has no sideways scroll and thumb-sized controls",async({page})=>{
    await page.goto("/login");
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for(const locator of [page.getByRole("button",{name:"Sign in"}),page.getByLabel("Email"),page.getByLabel("Password")]){
      const box=(await locator.boundingBox())!;
      expect(box.height,await locator.evaluate((n)=>n.outerHTML.slice(0,60))).toBeGreaterThanOrEqual(43.5);
    }
    // 16px text stops iOS zooming the page when a field gets focus.
    expect(await page.getByLabel("Email").evaluate((n)=>parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(16);
  });

  test("signed-in navigation is a bottom tab bar clear of the screen edge",async({page},testInfo)=>{
    await signIn(page,await createUser(testInfo));
    const bar=page.locator(".app-shell > .sidebar");
    await expect(bar).toBeVisible();
    const position=await bar.evaluate((n)=>{const r=n.getBoundingClientRect();const s=getComputedStyle(n);return {position:s.position,bottomGap:Math.round(innerHeight-r.bottom),top:r.top,height:r.height};});
    expect(position.position).toBe("fixed");
    expect(position.bottomGap).toBe(0);
    expect(position.top).toBeGreaterThan(300);
    for(const link of await bar.locator(".nav-link").all()){
      const box=(await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
    // Content is not hidden behind the bar: the last element can scroll above it.
    const content=page.locator(".app-shell");
    expect(await content.evaluate((n)=>parseFloat(getComputedStyle(n).paddingBottom))).toBeGreaterThanOrEqual(60);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("inside the Android / iOS app",()=>{
  test.use({userAgent:NATIVE_UA});

  test("plans are managed on the website and checkout is refused",async({page},testInfo)=>{
    await signIn(page,await createUser(testInfo));
    await page.goto("/app/settings");
    await expect(page.getByText("Plans are managed on the website")).toBeVisible();
    await expect(page.getByRole("button",{name:/upgrade|subscribe|choose|manage billing/i})).toHaveCount(0);
    const response=await page.request.post("/api/billing/checkout",{headers:{origin:new URL(page.url()).origin,"content-type":"application/json"},data:{planSlug:"pro",cadence:"monthly"}});
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toMatch(/website/i);
  });
});


test.describe("approved member command-centre visual contract",()=>{
  test("desktop keeps the 247px rail, 80px topbar and active navigation",async({page},testInfo)=>{
    test.skip(testInfo.project.name!=="desktop-chromium","desktop visual contract");
    await signIn(page,await createUser(testInfo));
    const shell=page.locator(".customer-workspace-shell");
    await expect(shell).toBeVisible();
    const sidebar=shell.locator(":scope > .sidebar");
    const topbar=shell.locator(".app-topbar");
    expect(await sidebar.evaluate(node=>Math.round(node.getBoundingClientRect().width))).toBe(247);
    expect(await topbar.evaluate(node=>Math.round(node.getBoundingClientRect().height))).toBe(80);
    // Both user-selectable themes retain their approved colour tokens.
    await page.evaluate(()=>document.documentElement.setAttribute("data-theme","dark"));
    expect(await shell.evaluate(node=>getComputedStyle(node).getPropertyValue("--cw-mint").trim())).toBe("#b7f5cc");
    await page.evaluate(()=>document.documentElement.setAttribute("data-theme","light"));
    expect(await shell.evaluate(node=>getComputedStyle(node).getPropertyValue("--cw-mint").trim())).toBe("#236e4d");
    await expect(sidebar.locator('.nav-link[aria-current="page"]')).toHaveText("Overview");
    await expect(page.getByRole("heading",{name:"Start with one simple decision."})).toBeVisible();
    await page.getByRole("link",{name:"My strategies",exact:true}).click();
    await expect(sidebar.locator('.nav-link[aria-current="page"]')).toHaveText("My strategies");
  });

  test("phone keeps the accessible bottom navigation without horizontal overflow",async({page},testInfo)=>{
    test.skip(testInfo.project.name!=="mobile-chromium","phone visual contract");
    await signIn(page,await createUser(testInfo));
    const shell=page.locator(".customer-workspace-shell");
    const sidebar=shell.locator(":scope > .sidebar");
    await expect(sidebar).toBeVisible();
    expect(await sidebar.evaluate(node=>getComputedStyle(node).position)).toBe("fixed");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    for(const link of await sidebar.locator(".nav-link").all()){
      const box=await link.boundingBox();
      expect(box?.height??0).toBeGreaterThanOrEqual(43.5);
    }
  });
});
