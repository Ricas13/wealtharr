import { test, expect } from "@playwright/test";

for (const path of ["/", "/demo", "/login", "/register"]) {
  test(path + " renders without horizontal overflow", async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  });
}

test("landing page exposes the three product questions clearly", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading",{level:1,name:/Follow the strategy.*Not the spreadsheet/i})).toBeVisible();
  if(page.viewportSize()&&page.viewportSize()!.width<=680){
    const menu=page.locator(".landing-mobile-nav > summary");
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.getByRole("link",{name:"Get started",exact:true})).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Explore the demo" })).toBeVisible();
});

test("demo is unmistakably fictional", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByText("Fictional demo data")).toBeVisible();
  await expect(page.getByText("Nothing on this page belongs to a real person or account.")).toBeVisible();
});


test("health endpoint reports core readiness without exposing secrets",async({request})=>{
  const response=await request.get("/api/health");
  expect(response.status()).toBe(200);
  const body=await response.json();
  expect(body).toMatchObject({ok:true,status:"ready",database:"ok"});
  expect(body).toHaveProperty("capabilities");
  const text=JSON.stringify(body);
  expect(text).not.toContain("ci-only");
  expect(text).not.toContain("strategyos:");
});
