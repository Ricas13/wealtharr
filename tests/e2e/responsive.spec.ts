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

test("new observatory landing explains the interactive illustration and offers usable navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading",{level:1,name:/Make the maths.*move/i})).toBeVisible();
  await expect(page.getByRole("link",{name:"Explore your options"})).toBeVisible();
  await expect(page.getByText("INTERACTIVE EXAMPLE / 01")).toBeVisible();
  await expect(page.getByText(/No market prices, returns, trades or actual strategy schedules are implied/)).toBeVisible();
  if(page.viewportSize()&&page.viewportSize()!.width<=680){
    const menu=page.locator(".wm-mobile-menu > summary");
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.locator(".wm-mobile-menu").getByRole("link",{name:"Get started"})).toBeVisible();
  }
  await expect(page.getByRole("link",{name:"Explore the interactive demo"})).toBeVisible();
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
  // The public answer is the readiness status only: no configuration detail without the cron secret.
  expect(body).toEqual({status:"ready"});
  const text=JSON.stringify(body);
  expect(text).not.toContain("ci-only");
  expect(text).not.toContain("strategyos:");
  const secret=process.env.CRON_SECRET;
  if(secret){
    const detailed=await (await request.get("/api/health",{headers:{authorization:"Bearer "+secret}})).json();
    expect(detailed).toMatchObject({ok:true,status:"ready",database:"ok"});
    expect(detailed).toHaveProperty("capabilities");
    expect(JSON.stringify(detailed)).not.toContain("ci-only");
  }
});
