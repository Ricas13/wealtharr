import {test,expect} from "@playwright/test";

test("new homepage comparison shows all catalogue methods without fabricated returns",async({page})=>{
  await page.goto("/");
  await expect(page.getByRole("heading",{level:1,name:/Invest your money/i})).toBeVisible();
  await expect(page.getByRole("heading",{name:/See how the strategies have performed/i})).toBeVisible();
  await expect(page.locator(".wm-compare-table tbody tr").first()).toContainText("SPY");
  await expect(page.locator(".wm-compare-table tbody tr").count()).resolves.toBeGreaterThan(8);
  await expect(page.getByRole("heading",{name:/Choose how you want to track/i})).toBeVisible();
  const body=await page.locator(".wm-compare-disclosure").textContent();
  expect(body).toMatch(/not actual investor returns|Historical.*model/);
});

test("visitors can search and filter catalogue while toggling return periods",async({page})=>{
  await page.goto("/");
  const table=page.getByRole("region",{name:"Scrollable strategy performance table"});
  const before=await table.locator("tbody tr").count();
  expect(before).toBeGreaterThan(8);
  await page.getByRole("searchbox",{name:"Search strategies"}).fill("Golden Butterfly");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table).toContainText("Golden Butterfly");
  await page.getByRole("button",{name:"3Y",exact:true}).click();
  await expect(page.getByRole("button",{name:"3Y",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("searchbox",{name:"Search strategies"}).fill("");
  const toggles=table.locator('input[type="checkbox"]:not(:disabled)');
  if(await toggles.count()){
    const first=toggles.first();
    const selected=await first.isChecked();
    await first.click();
    expect(await first.isChecked()).toBe(!selected);
  }else{
    await expect(table.getByText("Not verified").first()).toBeVisible();
  }
  await page.getByLabel("With data").check();
  await expect(page.locator(".wm-compare-table tbody tr").first()).toContainText("SPY");
});

test("mobile comparison remains accessible and honours reduced motion",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/");
  const table=page.getByRole("region",{name:"Scrollable strategy performance table"});
  await expect(table).toBeVisible();
  const dimensions=await page.evaluate(()=>({
    document:document.documentElement.scrollWidth,
    viewport:document.documentElement.clientWidth
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport+1);
  await table.focus();
  await expect(table).toBeFocused();
  if(page.viewportSize()&&page.viewportSize()!.width<=680){
    const menu=page.locator(".wm-mobile-menu>summary");
    await menu.click();
    await expect(page.locator(".wm-mobile-menu").getByRole("link",{name:"Get started"})).toBeVisible();
  }
});
