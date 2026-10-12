import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { finishPendingAccountDeletions } from "@/lib/account-deletion";

// Real database. Accounts whose Stripe disconnect can never succeed must not occupy every slot of the
// hourly deletion pass and starve newer requests behind them.
const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 2, prepare: false }) : null;

describe.skipIf(!url)("account deletion queue fairness", () => {
  const run = Math.random().toString(36).slice(2, 10);
  const created: string[] = [];
  const stalled: string[] = [];
  let healthy = "";
  let savedKey: string | undefined;

  beforeAll(async () => {
    // No Stripe key: any account with a Stripe customer cannot be disconnected, so it stalls forever.
    savedKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const [free] = await sql!.unsafe("SELECT id FROM plans WHERE slug='free'");
    for (let i = 0; i < 5; i += 1) {
      const [u] = await sql!.unsafe(
        "INSERT INTO users (email,password_hash,deleted_at) VALUES ($1,'x',now()-($2::int*interval '1 minute')) RETURNING id",
        [`del-stuck-${i}-${run}@example.test`, 600 - i]
      );
      stalled.push(String(u.id));
      created.push(String(u.id));
      await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence,stripe_customer_id) VALUES ($1,$2,'FREE','FREE',$3)", [u.id, free.id, `cus_stuck_${i}_${run}`]);
    }
    // Requested later than every stuck one, with nothing external to disconnect.
    const [h] = await sql!.unsafe("INSERT INTO users (email,password_hash,deleted_at) VALUES ($1,'x',now()-interval '10 minutes') RETURNING id", [`del-ok-${run}@example.test`]);
    healthy = String(h.id);
    created.push(healthy);
  });
  afterAll(async () => {
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedKey;
    if (!sql) return;
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])", [created]);
    await sql.unsafe("DELETE FROM audit_events WHERE entity_id=ANY($1)", [created]);
    await sql.end();
  });

  const present = async (id: string) => (await sql!.unsafe("SELECT 1 FROM users WHERE id=$1", [id])).length === 1;

  it("moves a stalled deletion behind ones that have not been tried, so newer requests are reached", async () => {
    // A cap equal to the number of stuck accounts: with plain oldest-first ordering the healthy
    // request is never reached.
    const first = await finishPendingAccountDeletions(stalled.length);
    expect(first).toMatchObject({ completed: 0, stalled: stalled.length });
    expect(await present(healthy)).toBe(true);
    const stamped = await sql!.unsafe("SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[]) AND deletion_attempted_at IS NOT NULL", [stalled]);
    expect(Number(stamped[0].n)).toBe(stalled.length);

    const second = await finishPendingAccountDeletions(stalled.length);
    expect(second.completed).toBeGreaterThanOrEqual(1);
    expect(await present(healthy)).toBe(false);
    for (const id of stalled) expect(await present(id)).toBe(true);
  });

  it("stops starting new attempts after its deadline and reports the rest as deferred", async () => {
    const result = await finishPendingAccountDeletions(25, { deadline: Date.now() - 1 });
    expect(result.completed).toBe(0);
    expect(result.stalled).toBe(0);
    expect(result.deferred).toBeGreaterThanOrEqual(stalled.length);
  });
});
