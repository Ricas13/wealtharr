import {test,expect} from "@playwright/test";

test("new homepage comparison shows all catalogue methods without fabricated returns",async({page})=>{
  await page.goto("/");
  await expect(page.getByRole("heading",{level:1,name:/Invest your money/i})).toBeVisible();
  await expect(page.getByRole("heading",{name:/See how the strategies have performed/i})).toBeVisible();
  await expect(page.locator(".wm-compare-table tbody tr").first()).toContainText("SPY");
  // The compact default shows SPY plus seven strategies, with every other
  // catalogue method available through a real disclosure control.
  await expect(page.locator(".wm-compare-table tbody tr")).toHaveCount(8);
  const table=page.getByRole("region",{name:"Scrollable strategy performance table"});
  const chart=page.getByRole("region",{name:"Overlapping strategy performance chart"});
  const above=await table.boundingBox(),below=await chart.boundingBox();
  expect(above).not.toBeNull();expect(below).not.toBeNull();
  expect(above!.y+above!.height).toBeLessThan(below!.y+1);
  const more=page.getByRole("button",{name:/Show more strategies/});
  await more.click();
  await expect(more).toHaveCount(0);
  await expect(table.locator("tbody tr").count()).resolves.toBeGreaterThan(8);
  await expect(page.getByRole("button",{name:/Show fewer strategies/})).toHaveAttribute("aria-expanded","true");
  await page.getByRole("button",{name:/Show fewer strategies/}).click();
  await expect(table.locator("tbody tr")).toHaveCount(8);
  await expect(page.getByRole("heading",{name:/Choose how you want to track/i})).toBeVisible();
  const body=await page.locator(".wm-compare-disclosure").textContent();
  expect(body).toMatch(/not actual investor returns|Historical.*model/);
});

test("visitors can search and filter catalogue while toggling return periods",async({page})=>{
  await page.goto("/");
  const table=page.getByRole("region",{name:"Scrollable strategy performance table"});
  const before=await table.locator("tbody tr").count();
  expect(before).toBe(8); // SPY plus seven collapsed catalogue strategies
  await page.getByRole("button",{name:/Show more strategies/}).click();
  await expect(table.locator("tbody tr").count()).resolves.toBeGreaterThan(8);
  await page.getByRole("searchbox",{name:"Search strategies"}).fill("Golden Butterfly");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table).toContainText("Golden Butterfly");
  await page.getByRole("button",{name:"3Y",exact:true}).click();
  await expect(page.getByRole("button",{name:"3Y",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByText("3Y return window")).toBeVisible();
  await expect(page.locator(".wm-compare-table thead .wm-compare-focused")).toHaveText("3Y");
  await page.getByRole("button",{name:"10Y",exact:true}).click();
  await expect(page.getByText("10Y return window")).toBeVisible();
  await page.getByRole("button",{name:"All",exact:true}).click();
  await expect(page.getByText("All available comparable history")).toBeVisible();
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
