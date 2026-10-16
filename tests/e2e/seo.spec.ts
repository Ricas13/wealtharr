import {test,expect} from "@playwright/test";

for(const [path,heading] of [
 ["/features","Track the rules. See the numbers. Know the next review."],
 ["/strategies","One portfolio workspace. Different rules."],
 ["/pricing","Start simple. Add strategies as you need them."],
 ["/faq","Frequently asked questions"],
 ["/tools/rebalance-calculator","Portfolio rebalancing calculator"],
 ["/learn","Portfolio research and rebalancing guides"],
 ["/learn/portfolio-rebalancing","How portfolio rebalancing calculations work"],
 ["/learn/uk-isa-portfolio-tracking","Tracking ETFs and ETPs in a UK Stocks and Shares ISA"],
 ["/learn/leveraged-etp-risks","Why daily-reset leveraged ETP returns can surprise investors"],
 ["/research-disclaimer","For research and educational purposes only"]
] as const){
 test("public SEO page "+path+" renders a canonical heading and metadata",async({page})=>{
  await page.goto(path);
  await expect(page.getByRole("heading",{level:1,name:heading})).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content",/.{50,}/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href",new RegExp(path+"$"));
 });
}
test("staging never accidentally exposes indexing",async({request})=>{
 const robots=await request.get("/robots.txt");
 expect(robots.ok()).toBe(true);
 expect(await robots.text()).toMatch(/Disallow:\s*\//i);
 const sitemap=await request.get("/sitemap.xml");
 expect(sitemap.ok()).toBe(true);
 expect(await sitemap.text()).not.toContain("/admin");
});
test("protected routes send noindex header",async({request})=>{
 const res=await request.get("/login",{maxRedirects:0});
 expect(res.headers()["x-robots-tag"]).toContain("noindex");
});

test("public calculator shows transparent target-weight adjustment",async({page})=>{
 await page.goto("/tools/rebalance-calculator");
 await expect(page.getByRole("heading",{name:"Illustrative sell £500.00"})).toBeVisible();
 await page.getByLabel("Current value of this holding (£)").fill("5000");
 await expect(page.getByRole("heading",{name:"Illustrative buy £1000.00"})).toBeVisible();
});

test("public pages display a consistent, linked research disclaimer instead of hidden SEO text",async({page})=>{
 await page.goto("/tools/rebalance-calculator");
 await expect(page.getByRole("complementary",{name:"Research and financial risk information"})).toBeVisible();
 await expect(page.getByRole("link",{name:"Read the full research disclaimer"})).toHaveAttribute("href","/research-disclaimer");
 await page.getByRole("link",{name:"Read the full research disclaimer"}).click();
 await expect(page.getByRole("heading",{level:1,name:"For research and educational purposes only"})).toBeVisible();
});
test("crawler can navigate from homepage to useful original guides with honest structured data",async({page})=>{
 await page.goto("/");
 await page.getByRole("link",{name:"Learning guides"}).last().click();
 await expect(page.getByRole("heading",{level:1,name:"Portfolio research and rebalancing guides"})).toBeVisible();
 await page.getByRole("link",{name:"Read guide →"}).first().click();
 await expect(page.getByRole("heading",{level:1,name:"How portfolio rebalancing calculations work"})).toBeVisible();
 const raw=await page.locator('script[type="application/ld+json"]').first().textContent();
 const data=JSON.parse(raw||"{}") as {"@graph"?:Array<{"@type"?:string}>};
 expect(data["@graph"]?.some(x=>x["@type"]==="Article")).toBe(true);
 expect(data["@graph"]?.some(x=>x["@type"]==="BreadcrumbList")).toBe(true);
});

test("mobile landing footer links and full disclaimer remain within the viewport",async({page},testInfo)=>{
 if(!testInfo.project.name.includes("mobile"))return;
 await page.goto("/");
 const width=page.viewportSize()?.width??390;
 for(const link of await page.locator(".wm-footer a").all()){
  const rect=await link.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x+rect!.width).toBeLessThanOrEqual(width+1);
 }
 const risk=await page.getByRole("complementary",{name:"Research and financial risk information"}).boundingBox();
 expect(risk).not.toBeNull();
 expect(risk!.x+risk!.width).toBeLessThanOrEqual(width+1);
});
