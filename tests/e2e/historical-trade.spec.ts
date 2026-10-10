import {test,expect} from "@playwright/test";
import bcrypt from "bcryptjs";
import postgres from "postgres";

test("backdated funding → broker fill → immutable ledger → pending review and replay safety",async({page},info)=>{
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("DATABASE_URL_REQUIRED");
  const sql=postgres(url,{max:1,prepare:false});
  const suffix=info.project.name.replace(/[^A-Z0-9]/gi,"").slice(0,9);
  const email="trade-e2e-"+suffix+"@example.test";
  const ticker=("E2E"+suffix).toUpperCase().slice(0,20);
  const executedAt="2026-09-02T14:00:00+01:00";
  const fundedAt="2026-09-02T13:00:00+01:00";
  const requestHeaders={origin:process.env.NEXT_PUBLIC_APP_URL??"http://127.0.0.1:3000"};
  try{
    const hash=await bcrypt.hash("e2e-password-1234",4);
    await sql.begin(async tx=>{
      await tx.unsafe("DELETE FROM users WHERE email=$1",[email]);
      // A previous attempt (or Playwright's retry) leaves its instrument and trading line behind;
      // without this the retry fails on a duplicate key and hides the first, real failure.
      await tx.unsafe("DELETE FROM instruments WHERE name=$1",["E2E instrument "+suffix]);
      const plan=await tx.unsafe("SELECT id FROM plans WHERE slug='free' LIMIT 1");
      if(!plan[0])throw new Error("FREE_PLAN_MISSING");
      const user=await tx.unsafe(
        "INSERT INTO users (email,password_hash,email_verified_at,country,base_currency,timezone) "+
        "VALUES ($1,$2,now(),'GB','GBP','Europe/London') RETURNING id",
        [email,hash]
      );
      await tx.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'FREE','FREE')",
        [user[0].id,plan[0].id]);
    });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("e2e-password-1234");
    await page.getByRole("button",{name:"Sign in"}).click();
    await page.waitForURL("**/app");

    await page.getByRole("link",{name:"Start my first strategy"}).click();
    await page.getByRole("button",{name:/Continue/}).click();
    await page.getByRole("button",{name:/Continue/}).click();
    await page.getByLabel("What should we call it?").fill("Historical trade integration");
    await page.getByLabel("How much are you starting with?").fill("0");
    await page.getByRole("button",{name:/Start my strategy/}).click();
    await page.waitForURL(/\/app\/strategies\/[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
    await expect(page.getByRole("heading",{name:"Historical trade integration"})).toBeVisible();
    const strategyId=page.url().split("/").pop()!;
    const accountRows=await sql.unsafe("SELECT account_id FROM strategy_instances WHERE id=$1",[strategyId]);
    expect(accountRows).toHaveLength(1);
    const accountId=String(accountRows[0].account_id);
    const instrument=await sql.unsafe(
      "INSERT INTO instruments (name,economic_exposure,leverage,direction) "+
      "VALUES ($1,'NASDAQ_100_3X_LONG',3,'LONG') RETURNING id",
      ["E2E instrument "+suffix]
    );
    const instrumentId=String(instrument[0].id);
    await sql.unsafe(
      "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) "+
      "VALUES ($1,$2,'LSE','GBP','Europe/London','2020-01-01')",
      [instrumentId,ticker]
    );

    const contribution=await page.request.post("/api/strategies/"+strategyId+"/contributions",{
      headers:requestHeaders,data:{amount:"1000",occurredAt:fundedAt,accountId,requestKey:crypto.randomUUID()}
    });
    expect(contribution.status(),await contribution.text()).toBe(200);

    const requestKey=crypto.randomUUID();
    const input={
      accountId,ticker,exchange:"LSE",executedAt,side:"BUY",quantity:"5",
      unitPrice:"100.12",fee:"1.50",requestKey,brokerFillConfirmed:true,
      note:"Broker-confirmed test fill"
    };
    const purchase=await page.request.post("/api/strategies/"+strategyId+"/trades",{headers:requestHeaders,data:input});
    expect(purchase.status(),await purchase.text()).toBe(200);
    const purchaseBody=await purchase.json();
    expect(purchaseBody.ok).toBe(true);
    expect(purchaseBody.duplicate).toBe(false);

    const duplicate=await page.request.post("/api/strategies/"+strategyId+"/trades",{headers:requestHeaders,data:input});
    expect(duplicate.status(),await duplicate.text()).toBe(200);
    expect((await duplicate.json()).duplicate).toBe(true);
    const conflict=await page.request.post("/api/strategies/"+strategyId+"/trades",{
      headers:requestHeaders,data:{...input,quantity:"6"}
    });
    expect(conflict.status()).toBe(409);

    const events=await sql.unsafe(
      "SELECT event_type,cash_amount,quantity,unit_price,fee_amount,occurred_at,metadata "+
      "FROM ledger_events WHERE strategy_instance_id=$1 AND event_type='BUY'",
      [strategyId]
    );
    expect(events).toHaveLength(1);
    expect(String(events[0].cash_amount)).toBe("-500.60000000");
    expect(String(events[0].quantity)).toBe("5.000000000000");
    expect(String(events[0].unit_price)).toBe("100.1200000000");
    expect(String(events[0].fee_amount)).toBe("1.50000000");
    expect(new Date(events[0].occurred_at).toISOString()).toBe("2026-09-02T13:00:00.000Z");

    const state=await sql.unsafe("SELECT state FROM strategy_states WHERE strategy_instance_id=$1",[strategyId]);
    // One imported fill cannot certify the whole allocation or close its review.
    expect(state[0]?.state.lastReviewAt).toBeUndefined();
    expect(state[0]?.state.forceReview).toBe(true);

    const impossibleSale=await page.request.post("/api/strategies/"+strategyId+"/trades",{
      headers:requestHeaders,data:{...input,side:"SELL",quantity:"100",requestKey:crypto.randomUUID()}
    });
    expect(impossibleSale.status()).toBe(409);

    const override=await page.request.post("/api/strategies/"+strategyId+"/overrides",{
      headers:requestHeaders,data:{fieldKey:"market_price:"+instrumentId,manualValue:"110",reason:"Verified broker current quote",
        observedAt:new Date().toISOString(),confirmed:true}
    });
    expect(override.status(),await override.text()).toBe(200);
    const evidence=await sql.unsafe(
      "SELECT manual_value,observed_at,expires_at FROM overrides "+
      "WHERE strategy_instance_id=$1 AND field_key=$2 AND active=true",[strategyId,"market_price:"+instrumentId]
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0].manual_value).toBe("110");
    expect(new Date(evidence[0].expires_at).getTime()).toBeGreaterThan(Date.now());

    const unsafe=await page.request.post("/api/strategies/"+strategyId+"/overrides",{
      headers:requestHeaders,data:{fieldKey:"strategy_state.forceReview",manualValue:"1",reason:"Force a review without approval",confirmed:true}
    });
    expect(unsafe.status()).toBe(400);
  }finally{
    await sql.unsafe("DELETE FROM users WHERE email=$1",[email]).catch(()=>{});
    await sql.unsafe("DELETE FROM instruments WHERE name=$1",["E2E instrument "+suffix]).catch(()=>{});
    await sql.end();
  }
});
