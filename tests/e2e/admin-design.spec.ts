import {test,expect} from "@playwright/test";
import bcrypt from "bcryptjs";
import postgres from "postgres";
import {randomUUID} from "node:crypto";

const PASSWORD="admin-design-test-password";
async function createAndSignIn(page:import("@playwright/test").Page){
 const sql=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
 const email="e2e-admin-design-"+randomUUID()+"@example.test";
 try {
  await sql.unsafe("INSERT INTO users(email,password_hash,email_verified_at,role) VALUES ($1,$2,now(),'ADMIN')",[email,await bcrypt.hash(PASSWORD,4)]);
 }finally{await sql.end();}
 await page.goto("/login");
 await page.getByLabel("Email").fill(email);
 await page.getByLabel("Password").fill(PASSWORD);
 await page.getByRole("button",{name:"Sign in"}).click();
 await page.waitForURL("**/app");
}
test("Master Admin uses the approved sidebar, spacing, metrics and SVG chart",async({page},testInfo)=>{
 await createAndSignIn(page);
 await page.goto("/admin");
 await expect(page.getByRole("heading",{name:"Overview",exact:true})).toBeVisible();
 await expect(page.getByRole("navigation",{name:"Master Admin navigation"})).toBeVisible();
 await expect(page.getByRole("region",{name:"Key business indicators"})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Revenue & growth"})).toBeVisible();
 const brand=page.getByRole("link",{name:"Wealtharr Master Admin home"});
 await expect(brand).toBeVisible();
 const styles=await page.locator(".admin-workspace-shell").evaluate(el=>{
  const root=getComputedStyle(el);
  const kpi=document.querySelector(".admin-design-kpi")!;
  const content=document.querySelector(".admin-workspace-content")!;
  const side=document.querySelector(".admin-workspace-sidebar")!;
  return {
   font:root.fontFamily,
   color:root.color,
   accent:root.getPropertyValue("--ac-primary-bg").trim(),
   kpiRadius:getComputedStyle(kpi).borderRadius,
   kpiPadding:getComputedStyle(kpi).paddingTop,
   sidebarWidth:Math.round(side.getBoundingClientRect().width),
   contentPadding:getComputedStyle(content).paddingTop
  };
 });
 expect(styles.font).toContain("Inter");
 expect(styles.accent).toBe("#344fad");
 expect(styles.kpiRadius).toBe("14px");
 expect(styles.kpiPadding).toBe(testInfo.project.name==="mobile-chromium"?"15px":"19px");
 expect(styles.contentPadding).toBe(testInfo.project.name==="mobile-chromium"?"23px":"35px");
 if(testInfo.project.name==="desktop-chromium")expect(styles.sidebarWidth).toBeGreaterThanOrEqual(210);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
 expect(overflow).toBeLessThanOrEqual(1);
});
test("wizard, Strategy Studio and integrations remain usable at different widths",async({page})=>{
 await createAndSignIn(page);
 for(const path of ["/admin/configuration","/admin/strategies","/admin/integrations","/admin/users","/admin/plans","/admin/security"]){
  await page.goto(path);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow,path).toBeLessThanOrEqual(1);
 }
 await page.goto("/admin/configuration");
 await expect(page.getByRole("heading",{name:"Set up Wealtharr"})).toBeVisible();
 await expect(page.getByRole("progressbar",{name:"Verified configuration progress"})).toBeVisible();
 await page.goto("/admin/strategies");
 await expect(page.getByRole("heading",{name:"Strategy Studio",exact:true})).toBeVisible();
 await page.goto("/admin/integrations");
 await expect(page.getByRole("heading",{name:"Integrations",exact:true})).toBeVisible();
 await expect(page.getByText("Planned",{exact:true})).toBeVisible();
});
