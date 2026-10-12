import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import postgres from "postgres";
import { currentStep, totpAt } from "../../src/domain/totp";

const PASSWORD="e2e-password-1234";

async function createUser(testInfo:{project:{name:string};workerIndex:number}){
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("DATABASE_URL is required for authenticated e2e tests");
  const project=testInfo.project.name.replace(/[^a-z0-9]+/gi,"-").toLowerCase();
  const email=`e2e-${project}-${testInfo.workerIndex}-twostep@example.test`;
  const sql=postgres(url,{max:1,prepare:false});
  try{
    const hash=await bcrypt.hash(PASSWORD,4);
    await sql.begin(async(tx)=>{
      await tx.unsafe("DELETE FROM users WHERE email=$1",[email]);
      const plans=await tx.unsafe("SELECT id FROM plans WHERE slug='free' LIMIT 1");
      const users=await tx.unsafe("INSERT INTO users (email,password_hash,email_verified_at) VALUES ($1,$2,now()) RETURNING id",[email,hash]);
      await tx.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'FREE','FREE')",[users[0].id,plans[0].id]);
    });
  }finally{await sql.end();}
  return email;
}

test("an unauthenticated visit to a deep link returns there after sign-in, and two-step sign-in is enforced once on",async({page,context},testInfo)=>{
  const email=await createUser(testInfo);

  // Deep link -> login -> back to the page originally requested.
  await page.goto("/app/settings");
  await page.waitForURL(/\/login\?next=%2Fapp%2Fsettings/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button",{name:"Sign in"}).click();
  await page.waitForURL("**/app/settings");

  // An off-site `next` is ignored.
  await context.clearCookies();
  await page.goto("/login?next=https://evil.example/steal");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button",{name:"Sign in"}).click();
  await page.waitForURL("**/app");
  expect(new URL(page.url()).origin).toBe(new URL(testInfo.project.use.baseURL??"http://127.0.0.1:3000").origin);

  // Turn two-step sign-in on from settings.
  await page.goto("/app/settings");
  // Starting enrolment asks for the current password.
  await page.getByLabel("Password",{exact:true}).fill(PASSWORD);
  await page.getByRole("button",{name:"Set up two-step sign-in"}).click();
  const secret=await page.getByLabel("Key").inputValue();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel("Code from the app").fill(totpAt(secret,currentStep(new Date())));
  await page.getByLabel("Password",{exact:true}).fill(PASSWORD);
  await page.getByRole("button",{name:"Confirm and turn on"}).click();
  await expect(page.getByText("Save these recovery codes")).toBeVisible();
  const recovery=(await page.locator("pre").innerText()).split("\n").filter(Boolean);
  expect(recovery).toHaveLength(10);

  // Password alone no longer signs in.
  await context.clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button",{name:"Sign in"}).click();
  await expect(page.getByText(/authentication code is incorrect/i)).toBeVisible();

  // A recovery code works once.
  await page.getByLabel("Authentication code").fill(recovery[0]);
  await page.getByRole("button",{name:"Sign in"}).click();
  await page.waitForURL("**/app");
  await context.clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Authentication code").fill(recovery[0]);
  await page.getByRole("button",{name:"Sign in"}).click();
  await expect(page.getByText(/authentication code is incorrect/i)).toBeVisible();

  // So does a fresh authenticator code (next step, because enrolment used the current one).
  await page.getByLabel("Authentication code").fill(totpAt(secret,currentStep(new Date())+1));
  await page.getByRole("button",{name:"Sign in"}).click();
  await page.waitForURL("**/app");
});
