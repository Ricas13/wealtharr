import { readFileSync } from "node:fs";
import postgres from "postgres";
import { coverageReport, parseInstrumentCsv } from "../src/domain/instrument-import";
import { RESEARCH_STRATEGIES } from "../src/domain/strategy/research-catalog";

/**
 * Usage: tsx scripts/import-instruments.ts <file.csv> [--apply]
 * Without --apply it only validates and prints the coverage report. With --apply it stores the rows
 * as CANDIDATE mappings, which the resolver ignores until a person verifies and promotes them.
 */
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: tsx scripts/import-instruments.ts <file.csv> [--apply]");
  const apply = process.argv.includes("--apply");
  const { rows, errors } = parseInstrumentCsv(readFileSync(file, "utf8"));
  for (const error of errors) console.error("line " + error.line + ": " + error.message);
  if (errors.length) { console.error(errors.length + " row(s) rejected; nothing was written."); process.exit(1); }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (apply) {
      await sql.begin(async (tx) => {
        for (const row of rows) {
          const [instrument] = await tx.unsafe("INSERT INTO instruments (isin,name,economic_exposure,leverage,direction,fund_currency) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (isin) DO UPDATE SET name=EXCLUDED.name,updated_at=now() RETURNING id", [row.isin, row.name, row.exposure, row.leverage, row.direction, row.fundCurrency]);
          // An existing line is never repointed or altered by an import: it may sit behind a verified mapping.
          await tx.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (exchange,ticker,effective_from) DO NOTHING", [instrument.id, row.ticker, row.exchange, row.currency, row.timezone, today]);
          const [line] = await tx.unsafe("SELECT id,instrument_id FROM trading_lines WHERE exchange=$1 AND ticker=$2 AND effective_from=$3", [row.exchange, row.ticker, today]);
          if (!line || String(line.instrument_id) !== String(instrument.id)) { console.error("skipped " + row.isin + " " + row.exchange + ":" + row.ticker + ": trading line already belongs to another instrument"); continue; }
          await tx.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,direction,country,wrapper,trading_line_id,fidelity,effective_from) SELECT $1,$2,$3,$4,$5,$6,'CANDIDATE',$7 WHERE NOT EXISTS (SELECT 1 FROM regional_instrument_mappings WHERE trading_line_id=$6 AND country=$4 AND wrapper=$5)", [row.exposure, row.leverage, row.direction, row.country, row.wrapper, line.id, today]);
        }
      });
      console.log("Stored " + rows.length + " candidate mapping(s). None can drive a trade until promoted to EXACT.");
    } else console.log(rows.length + " row(s) valid (dry run; pass --apply to store as candidates).");

    const mappings = (await sql.unsafe("SELECT economic_exposure AS exposure,country,wrapper,fidelity FROM regional_instrument_mappings WHERE enabled")) as unknown as Array<{ exposure: string; country: string; wrapper: string; fidelity: string }>;
    const required = RESEARCH_STRATEGIES.flatMap((s) => ((s.config as { allocations?: Array<{ exposure: string }> } | undefined)?.allocations ?? []).map((a) => a.exposure));
    for (const place of [...new Set(rows.map((r) => r.country + "/" + r.wrapper))]) {
      const [country, wrapper] = place.split("/");
      console.log("\nCoverage for " + place);
      for (const entry of coverageReport(required, mappings, country, wrapper)) console.log("  " + entry.status.padEnd(15) + entry.exposure);
    }
  } finally { await sql.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
