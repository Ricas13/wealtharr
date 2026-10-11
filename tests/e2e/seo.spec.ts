import {test,expect} from "@playwright/test";

for(const [path,heading] of [
 ["/features","Track the rules. See the numbers. Know the next review."],
 ["/strategies","One portfolio workspace. Different rules."],
 ["/pricing","Simple plans. Powerful tracking."],
 ["/faq","Frequently asked questions"],
 ["/tools/rebalance-calculator","Portfolio rebalancing calculator"]
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
