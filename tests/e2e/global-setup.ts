import postgres from "postgres";

/**
 * Browser integration tests need ONE verified GBP/ISA example for the seeded 9Sig
 * strategy. Nothing here is production data, a real ticker or a provider quote.
 * The fixture is shared across Playwright workers to avoid conflicting mappings.
 */
export default async function globalSetup() {
  const url=process.env.DATABASE_URL;
  if(!url)throw new Error("E2E_DATABASE_REQUIRED");
  const sql=postgres(url,{max:1,prepare:false});
  try {
    await sql.begin(async tx=>{
      const name="E2E mock 9Sig exact instrument — not tradable";
      const existing=await tx.unsafe("SELECT id FROM instruments WHERE name=$1 LIMIT 1",[name]);
      const instrument=existing[0]??(await tx.unsafe(
        "INSERT INTO instruments (name,economic_exposure,leverage,direction,fund_currency) VALUES ($1,'NASDAQ_100_3X_LONG',3,'LONG','GBP') RETURNING id",[name]
      ))[0];
      const lines=await tx.unsafe(
        "INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) "+
        "VALUES ($1,'E2E9SIG3X','LSE','GBP','Europe/London','2020-01-01') "+
        "ON CONFLICT (exchange,ticker,effective_from) DO UPDATE SET instrument_id=EXCLUDED.instrument_id RETURNING id",
        [instrument.id]
      );
      await tx.unsafe(
        "INSERT INTO regional_instrument_mappings (economic_exposure,leverage,direction,country,wrapper,trading_line_id,fidelity,effective_from,enabled) "+
        "SELECT 'NASDAQ_100_3X_LONG',3,'LONG','GB','ISA',$1,'EXACT','2020-01-01',true "+
        "WHERE NOT EXISTS (SELECT 1 FROM regional_instrument_mappings WHERE trading_line_id=$1 AND country='GB' AND wrapper='ISA')",
        [lines[0].id]
      );
    });
  } finally {await sql.end();}
}
