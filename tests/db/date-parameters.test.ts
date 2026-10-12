import { afterAll,describe,expect,it } from "vitest";
import { sql } from "@/lib/db";

// Regression: drizzle's postgres-js adapter used to turn the client's timestamp serializers into
// pass-through functions, so any Date bound as a parameter crashed the driver. This broke the
// Stripe webhook, action calculation, contributions and cash events.
describe.skipIf(!process.env.DATABASE_URL)("Date query parameters",()=>{
  afterAll(async()=>{await sql.end();});

  it("accepts a Date next to untyped string parameters",async()=>{
    const at=new Date("2030-01-02T03:04:05.000Z");
    const rows=await sql.unsafe("SELECT $1::text AS label, $2::timestamptz AS at",["x",at]);
    expect(new Date(String(rows[0].at)).toISOString()).toBe(at.toISOString());
  });

  it("accepts a Date as the only parameter",async()=>{
    const at=new Date("2030-01-02T03:04:05.000Z");
    const rows=await sql.unsafe("SELECT $1::timestamptz AS at",[at]);
    expect(new Date(String(rows[0].at)).toISOString()).toBe(at.toISOString());
  });

  it("still accepts timestamps passed as text and nulls",async()=>{
    const rows=await sql.unsafe("SELECT $1::timestamptz AS at, $2::timestamptz AS none",["2030-01-02T03:04:05Z",null]);
    expect(new Date(String(rows[0].at)).toISOString()).toBe("2030-01-02T03:04:05.000Z");
    expect(rows[0].none).toBeNull();
  });

  // The client used to inherit these behaviours from a drizzle client constructed as a side effect;
  // they are now configured explicitly in src/lib/db-config.ts and must not regress.
  it("returns date, timestamp and timestamptz columns as strings, not Date objects",async()=>{
    const rows=await sql.unsafe("SELECT '2030-01-02'::date AS d, '2030-01-02 03:04:05'::timestamp AS ts, '2030-01-02 03:04:05+00'::timestamptz AS tz, ARRAY['2030-01-02']::date[] AS da");
    expect(typeof rows[0].d).toBe("string");
    expect(String(rows[0].d).slice(0,10)).toBe("2030-01-02");
    expect(typeof rows[0].ts).toBe("string");
    expect(typeof rows[0].tz).toBe("string");
    expect(rows[0].da).not.toBeInstanceOf(Date);
  });

  it("stores an already-stringified JSON parameter as an object, not a double-encoded string",async()=>{
    const rows=await sql.unsafe("SELECT jsonb_typeof($1::jsonb) AS kind, $1::jsonb AS value",[JSON.stringify({a:1})]);
    expect(rows[0].kind).toBe("object");
    expect(rows[0].value).toEqual({a:1});
  });
});
