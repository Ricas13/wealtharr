import {test,expect} from "@playwright/test";
test("interactive observatory reacts to keyboard, cash and target without showing fictional history",async({page})=>{
 await page.goto("/");
 const instrument=page.getByRole("region",{name:/THE ALLOCATION OBSERVATORY/i});
 await expect(instrument).toBeVisible();
 await expect(instrument.locator(".wm-obs-equation strong").nth(0)).toHaveText(/−.*100/);
 await expect(instrument.locator(".wm-obs-equation strong").nth(1)).toHaveText(/\\+.*600/);
 const cash=page.getByRole("slider",{name:/ADD CASH/i});
 const target=page.getByRole("slider",{name:/EQUITY TARGET/i});
 await expect(cash).toHaveValue("500");
 await expect(target).toHaveValue("60");
 await target.focus();
 await page.keyboard.press("ArrowRight");
 await expect(target).toHaveValue("65");
 await expect(instrument.locator(".wm-obs-equation strong").nth(0)).toHaveText(/\\+.*425/);
 await expect(instrument.locator(".wm-obs-equation strong").nth(1)).toHaveText(/\\+.*75/);
 await cash.fill("1000");
 await expect(instrument.locator(".wm-obs-equation strong").nth(0)).toHaveText(/\\+.*750/);
 await expect(instrument.locator(".wm-obs-equation strong").nth(1)).toHaveText(/\\+.*250/);
 await instrument.getByRole("button",{name:"30 days"}).click();
 await expect(instrument.getByText("15 Nov 2026")).toBeVisible();
 await instrument.getByRole("button",{name:"365 days"}).click();
 await expect(instrument.getByText("16 Oct 2027")).toBeVisible();
 await expect(instrument).toContainText("No market prices, returns, trades or actual strategy schedules");
});
test("direct orbit dragging updates the same accessible slider",async({page})=>{
 await page.goto("/");
 const svg=page.locator(".wm-obs-visual svg");
 await svg.scrollIntoViewIfNeeded();\n const rect=await svg.boundingBox();
 expect(rect).not.toBeNull();
 const point=(percent:number,radius:number)=>{const theta=(percent/100*360-90)*Math.PI/180;return {
  x:rect!.x+(280+Math.cos(theta)*radius)*rect!.width/560,
  y:rect!.y+(235+Math.sin(theta)*radius)*rect!.height/505
 };};
 const origin=point(60,184),destination=point(70,184);
 await page.mouse.move(origin.x,origin.y);
 await page.mouse.down();
 await page.mouse.move(destination.x,destination.y,{steps:6});
 await page.mouse.up();
 await expect(page.getByRole("slider",{name:/EQUITY TARGET/i})).toHaveValue("70");
});
test("instrument remains usable on mobile and with reduced motion",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.goto("/");
 const region=page.getByRole("region",{name:/THE ALLOCATION OBSERVATORY/i});
 await expect(region).toBeVisible();
 const rect=await region.boundingBox();
 expect(rect).not.toBeNull();
 expect(rect!.x+rect!.width).toBeLessThanOrEqual((page.viewportSize()?.width??1280)+1);
 const slider=page.getByRole("slider",{name:/ADD CASH/i});
 await slider.fill("0");
 await expect(region.locator(".wm-obs-svg-eyebrow")).toHaveText("PORTFOLIO + CASH");
 await expect(region.locator(".wm-obs-svg-value")).toHaveText(/10[.,]000/);
});
