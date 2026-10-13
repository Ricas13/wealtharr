import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import { sql } from "@/lib/db";
import { isValidIsin } from "@/domain/instrument-import";
import { VERIFIED_MARKET_MAPPINGS_SQL } from "@/lib/verified-market-mappings";

const admin=vi.hoisted(()=>({id:""}));
vi.mock("@/lib/session",()=>({requireAdmin:async()=>admin}));

const ORIGIN="http://127.0.0.1:3000";
const run=Math.random().toString(36).slice(2,10).toUpperCase();
const wrapper="PROMO-"+run;
const instruments:string[]=[];
const checklist={factsheetChecked:true,underlyingMatchesExposure:true,leverageAndDirectionMatch:true,listingCurrencyAndExchangeCorrect:true,wrapperAndCountryEligible:true};
const note="Verified against the issuer KID and factsheet for this run.";

// Builds a valid ISO 6166 ISIN from an 11-character body (Luhn over the expanded digits).
function isinFor(body:string){
  const digits=body.split("").map((c)=>/[A-Z]/.test(c)?String(c.charCodeAt(0)-55):c).join("");
  let sum=0,double=true;
  for(let i=digits.length-1;i>=0;i-=1){let n=Number(digits[i]);if(double){n*=2;if(n>9)n-=9;}sum+=n;double=!double;}
  return body+String((10-(sum%10))%10);
}
let seq=0;
function freshIsin(){seq+=1;const body="ZZ"+run.padEnd(6,"0").slice(0,6)+String(seq).padStart(3,"0");return isinFor(body);}

async function seed(opts:{isin?:string|null;exposure?:string;leverage?:number;fidelity?:string;country?:string;wrapper?:string;broker?:string|null}={}){
  const isin=opts.isin===undefined?freshIsin():opts.isin;
  const inst=await sql.unsafe("INSERT INTO instruments (isin,name,economic_exposure,leverage,direction,fund_currency) VALUES ($1,$2,$3,$4,'LONG','GBP') RETURNING id",[isin,"Promo "+run,opts.exposure??"BROAD_EQUITY",opts.leverage??1]);
  const instrumentId=String(inst[0].id);instruments.push(instrumentId);
  seq+=1;
  const line=await sql.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London','2026-01-01') RETURNING id",[instrumentId,"P"+run+seq]);
  const lineId=String(line[0].id);
  const country=opts.country??"GB";
  const mapping=await sql.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,direction,country,wrapper,trading_line_id,fidelity,effective_from,enabled,broker) VALUES ($1,$2,'LONG',$3,$4,$5,$6,'2026-01-01',true,$7) RETURNING id",[opts.exposure??"BROAD_EQUITY",opts.leverage??1,country,opts.wrapper??wrapper,lineId,opts.fidelity??"CANDIDATE",opts.broker??null]);
  return {isin,instrumentId,lineId,mappingId:String(mapping[0].id),country,ticker:"P"+run+seq,wrapper:opts.wrapper??wrapper};
}
const subjectOf=(s:{lineId:string;country:string;wrapper?:string})=>({economicExposure:"BROAD_EQUITY",leverage:"1",direction:"LONG",country:s.country,wrapper:s.wrapper??wrapper,tradingLineId:s.lineId});
async function put(body:unknown){
  const {PUT}=await import("@/app/api/admin/instruments/route");
  const response=await PUT(new Request(ORIGIN+"/api/admin/instruments",{method:"PUT",headers:{origin:ORIGIN,"content-type":"application/json"},body:JSON.stringify(body)}));
  return {status:response.status,body:await response.json() as Record<string,unknown>};
}
const promote=(s:{mappingId:string;isin:string|null;lineId:string;country:string;wrapper?:string},over:Record<string,unknown>={})=>put({kind:"promote",mappingId:s.mappingId,isin:s.isin,providerSymbol:null,checklist,subject:subjectOf(s),note,...over});
const fidelityOf=async(id:string)=>(await sql.unsafe("SELECT fidelity,enabled FROM regional_instrument_mappings WHERE id=$1",[id]))[0];
const resolvable=async(id:string)=>(await sql.unsafe("SELECT m.id FROM ("+VERIFIED_MARKET_MAPPINGS_SQL+") m WHERE m.id=$1",[id])).length;

describe.skipIf(!process.env.DATABASE_URL)("candidate promotion",()=>{
  beforeAll(async()=>{
    admin.id=String((await sql.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x','ADMIN') RETURNING id",["promo-"+crypto.randomUUID()+"@example.test"]))[0].id);
  });
  afterAll(async()=>{
    if(instruments.length){
      await sql.unsafe("DELETE FROM regional_instrument_mappings WHERE trading_line_id IN (SELECT id FROM trading_lines WHERE instrument_id=ANY($1::uuid[]))",[instruments]);
      await sql.unsafe("DELETE FROM trading_lines WHERE instrument_id=ANY($1::uuid[])",[instruments]);
      await sql.unsafe("DELETE FROM instruments WHERE id=ANY($1::uuid[])",[instruments]);
    }
    await sql.unsafe("DELETE FROM audit_events WHERE actor_user_id=$1",[admin.id]);
    if(admin.id)await sql.unsafe("DELETE FROM users WHERE id=$1",[admin.id]);
    await sql.end();
  });

  it("generates valid test ISINs", ()=>{expect(isValidIsin(freshIsin())).toBe(true);});

  it("keeps a candidate out of the resolver, then promotes it to EXACT with an audit record",async()=>{
    const s=await seed();
    expect(await resolvable(s.mappingId)).toBe(0);
    const result=await promote(s,{providerSymbol:"PROMO.L"});
    expect(result.status).toBe(200);
    const row=await fidelityOf(s.mappingId);
    expect(row.fidelity).toBe("EXACT");expect(row.enabled).toBe(true);
    expect(await resolvable(s.mappingId)).toBe(1);
    expect((await sql.unsafe("SELECT provider_symbol FROM trading_lines WHERE id=$1",[s.lineId]))[0].provider_symbol).toBe("PROMO.L");
    const audit=await sql.unsafe("SELECT metadata FROM audit_events WHERE actor_user_id=$1 AND action='instrument-mapping.promoted' AND entity_id=$2",[admin.id,s.mappingId]);
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata.note).toBe(note);
    expect(audit[0].metadata.checklist).toEqual(checklist);
    expect(audit[0].metadata.isin).toBe(s.isin);
  });

  it("refuses promotion of a mapping that is not a candidate",async()=>{
    const s=await seed({fidelity:"EXACT",country:"IE"});
    const result=await promote(s);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("NOT_CANDIDATE");
    const again=await seed({country:"IT"});
    expect((await promote(again)).status).toBe(200);
    expect((await promote(again)).status).toBe(409);
  });

  it("refuses an incomplete checklist, a short note and a malformed ISIN without changing anything",async()=>{
    const s=await seed();
    expect((await promote(s,{checklist:{...checklist,factsheetChecked:false}})).status).toBe(400);
    expect((await promote(s,{note:"too short"})).status).toBe(400);
    expect((await promote(s,{isin:"GB0002634947"})).status).toBe(400);
    expect((await fidelityOf(s.mappingId)).fidelity).toBe("CANDIDATE");
    expect(await sql.unsafe("SELECT id FROM audit_events WHERE entity_id=$1",[s.mappingId])).toHaveLength(0);
  });

  it("refuses when the verified subject no longer matches the stored mapping or instrument",async()=>{
    const s=await seed();
    const changed=await promote(s,{subject:{...subjectOf(s),leverage:"2"}});
    expect(changed.status).toBe(409);expect(changed.body.code).toBe("SUBJECT_CHANGED");
    const mismatch=await seed();
    await sql.unsafe("UPDATE instruments SET leverage=3 WHERE id=$1",[mismatch.instrumentId]);
    const result=await promote(mismatch);
    expect(result.status).toBe(409);expect(result.body.code).toBe("INSTRUMENT_MISMATCH");
    expect((await fidelityOf(s.mappingId)).fidelity).toBe("CANDIDATE");
    expect((await fidelityOf(mismatch.mappingId)).fidelity).toBe("CANDIDATE");
  });

  it("refuses an ISIN that differs from the stored one and fills a missing one",async()=>{
    const s=await seed();
    const other=await promote(s,{isin:freshIsin()});
    expect(other.status).toBe(409);expect(other.body.code).toBe("ISIN_MISMATCH");
    const blank=await seed({isin:null,country:"ES"});
    const isin=freshIsin();
    expect((await promote(blank,{isin})).status).toBe(200);
    expect((await sql.unsafe("SELECT isin FROM instruments WHERE id=$1",[blank.instrumentId]))[0].isin).toBe(isin);
    const clash=await seed({isin:null,country:"ES"});
    const taken=await promote(clash,{isin});
    expect(taken.status).toBe(409);expect(taken.body.code).toBe("ISIN_IN_USE");
  });

  it("refuses to create an ambiguous pair with a different trading line",async()=>{
    const first=await seed({country:"FR"});
    expect((await promote(first)).status).toBe(200);
    const second=await seed({country:"FR"});
    const result=await promote(second);
    expect(result.status).toBe(409);expect(result.body.code).toBe("AMBIGUOUS_MAPPING");
    expect((await fidelityOf(second.mappingId)).fidelity).toBe("CANDIDATE");
    expect(await resolvable(second.mappingId)).toBe(0);
  });

  it("rejects a candidate without deleting it, and only from CANDIDATE",async()=>{
    const s=await seed();
    const result=await put({kind:"reject",mappingId:s.mappingId,note:"Tracks a different index than the exposure requires."});
    expect(result.status).toBe(200);
    const row=await fidelityOf(s.mappingId);
    expect(row.fidelity).toBe("REJECTED");expect(row.enabled).toBe(false);
    expect(await resolvable(s.mappingId)).toBe(0);
    expect(await sql.unsafe("SELECT id FROM audit_events WHERE action='instrument-mapping.rejected' AND entity_id=$1",[s.mappingId])).toHaveLength(1);
    const again=await put({kind:"reject",mappingId:s.mappingId,note:"Tracks a different index than the exposure requires."});
    expect(again.status).toBe(409);
    expect((await promote(s)).status).toBe(409);
  });

  it("creates mappings only as disabled candidates and never as EXACT",async()=>{
    const s=await seed({country:"SE"});
    await sql.unsafe("DELETE FROM regional_instrument_mappings WHERE id=$1",[s.mappingId]);
    const base={kind:"mapping",economicExposure:"BROAD_EQUITY",leverage:"1",direction:"LONG",country:"SE",wrapper,tradingLineId:s.lineId,effectiveFrom:"2026-01-01"};
    const exact=await put({...base,fidelity:"EXACT",enabled:true});
    expect(exact.status).toBe(400);
    expect(await sql.unsafe("SELECT id FROM regional_instrument_mappings WHERE trading_line_id=$1",[s.lineId])).toHaveLength(0);
    const created=await put({...base,enabled:true});
    expect(created.status).toBe(200);
    const rows=await sql.unsafe("SELECT id,fidelity,enabled FROM regional_instrument_mappings WHERE trading_line_id=$1",[s.lineId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].fidelity).toBe("CANDIDATE");expect(rows[0].enabled).toBe(false);
    expect(await resolvable(String(rows[0].id))).toBe(0);
  });

  it("refuses changing or repointing an instrument or line that sits behind a verified mapping",async()=>{
    const s=await seed({country:"NO"});
    expect((await promote(s)).status).toBe(200);
    const edit=(over:Record<string,unknown>)=>put({kind:"instrument",id:s.instrumentId,isin:s.isin,name:"Renamed "+run,economicExposure:"BROAD_EQUITY",leverage:"1.000000",direction:"LONG",fundCurrency:"GBP",...over});
    expect((await edit({})).status).toBe(200);
    const blockedIsin=await edit({isin:freshIsin()});
    expect(blockedIsin.status).toBe(409);expect(blockedIsin.body.code).toBe("INSTRUMENT_IN_USE");
    expect((await edit({economicExposure:"GOLD"})).status).toBe(409);
    expect((await edit({leverage:"2"})).status).toBe(409);
    const stored=(await sql.unsafe("SELECT isin,economic_exposure,leverage::text AS leverage FROM instruments WHERE id=$1",[s.instrumentId]))[0];
    expect(stored.isin).toBe(s.isin);expect(stored.economic_exposure).toBe("BROAD_EQUITY");expect(Number(stored.leverage)).toBe(1);

    const line=(await sql.unsafe("SELECT ticker,exchange,effective_from::text AS effective_from FROM trading_lines WHERE id=$1",[s.lineId]))[0];
    const other=await seed({country:"DK"});
    const lineBody=(over:Record<string,unknown>)=>put({kind:"tradingLine",instrumentId:s.instrumentId,ticker:line.ticker,exchange:line.exchange,currency:"GBP",exchangeTimezone:"Europe/London",effectiveFrom:line.effective_from,...over});
    const repoint=await lineBody({instrumentId:other.instrumentId});
    expect(repoint.status).toBe(409);expect(repoint.body.code).toBe("TRADING_LINE_IN_USE");
    expect((await lineBody({currency:"USD"})).status).toBe(409);
    expect((await sql.unsafe("SELECT instrument_id::text AS i FROM trading_lines WHERE id=$1",[s.lineId]))[0].i).toBe(s.instrumentId);
    expect((await lineBody({})).status).toBe(200);
  });

  it("refuses overwriting a different provider symbol that other verified mappings rely on and audits the previous one",async()=>{
    const first=await seed({country:"AT"});
    expect((await promote(first,{providerSymbol:"AAA.L"})).status).toBe(200);
    const audit=await sql.unsafe("SELECT metadata FROM audit_events WHERE action='instrument-mapping.promoted' AND entity_id=$1",[first.mappingId]);
    expect(audit[0].metadata.previousProviderSymbol).toBeNull();
    const extra=await sql.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,direction,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ('BROAD_EQUITY',1,'LONG','BE',$1,$2,'CANDIDATE','2026-01-01',true) RETURNING id",[wrapper,first.lineId]);
    const result=await put({kind:"promote",mappingId:String(extra[0].id),isin:first.isin,providerSymbol:"BBB.L",checklist,subject:{...subjectOf(first),country:"BE"},note});
    expect(result.status).toBe(409);expect(result.body.code).toBe("PROVIDER_SYMBOL_CONFLICT");
    expect((await sql.unsafe("SELECT provider_symbol FROM trading_lines WHERE id=$1",[first.lineId]))[0].provider_symbol).toBe("AAA.L");
  });

  describe("GB / ISA evidence",()=>{
    const hash="b".repeat(64);
    const evidenceFor=(s:{ticker:string},over:Record<string,unknown>={})=>({
      kidUrl:"https://issuer.example/kid.pdf",kidRetrievedAt:"2026-10-01",kidSha256:hash,
      isaEligibility:{basis:"UCITS_OR_AUTHORISED_FUND",sourceUrl:"https://www.gov.uk/guidance/example",checkedAt:"2026-10-02"},
      listingEvidence:{exchange:"LSE",ticker:s.ticker,currency:"GBP"},
      ...over
    });
    // A run-unique broker keeps these mappings out of every other test's lookup key.
    const broker="PROMOBROKER-"+run;
    const snapshot={broker,source:"Instrument list export, test fixture",capturedAt:"2026-10-05",fractionalSupported:true};

    it("refuses a GB / ISA promotion without evidence, listing every missing item, and changes nothing",async()=>{
      const s=await seed({country:"GB",wrapper:"ISA",broker});
      const result=await promote(s);
      expect(result.status).toBe(400);
      expect(result.body.code).toBe("EVIDENCE_REQUIRED");
      const issues=(result.body.issues as string[]).join("|");
      for(const item of ["KID or factsheet","isaEligibility","brokerSnapshot"])expect(issues).toContain(item);
      expect((await fidelityOf(s.mappingId)).fidelity).toBe("CANDIDATE");
      expect(await sql.unsafe("SELECT id FROM audit_events WHERE entity_id=$1",[s.mappingId])).toHaveLength(0);
    });

    it("refuses a missing KID hash, a mismatching listing and a missing broker snapshot",async()=>{
      const s=await seed({country:"GB",wrapper:"ISA",broker});
      const {kidSha256:_h,...noHash}=evidenceFor(s,{brokerSnapshot:snapshot}) as Record<string,unknown>;
      expect((await promote(s,{evidence:noHash})).status).toBe(400);
      const wrongLine=await promote(s,{evidence:evidenceFor(s,{brokerSnapshot:snapshot,listingEvidence:{exchange:"LSE",ticker:"NOTTHIS",currency:"GBP"}})});
      expect(wrongLine.status).toBe(400);
      expect((wrongLine.body.issues as string[]).join("|")).toContain("listingEvidence.ticker");
      const noSnapshot=await promote(s,{evidence:evidenceFor(s)});
      expect(noSnapshot.status).toBe(400);
      expect((noSnapshot.body.issues as string[]).join("|")).toContain("brokerSnapshot");
      expect((await fidelityOf(s.mappingId)).fidelity).toBe("CANDIDATE");
    });

    it("refuses a broker-agnostic GB / ISA promotion without evidence, even with a complete checklist",async()=>{
      const s=await seed({country:"GB",wrapper:"ISA"});
      const result=await promote(s,{evidence:{}});
      expect(result.status).toBe(400);
      expect((await fidelityOf(s.mappingId)).fidelity).toBe("CANDIDATE");
    });

    it("promotes with complete evidence, stores it on the mapping and audits its hash",async()=>{
      const s=await seed({country:"GB",wrapper:"ISA",broker});
      const evidence=evidenceFor(s,{brokerSnapshot:snapshot,distributionPolicy:"ACCUMULATING",ter:"0.0007"});
      const result=await promote(s,{evidence});
      expect(result.status).toBe(200);
      const row=(await sql.unsafe("SELECT fidelity,evidence FROM regional_instrument_mappings WHERE id=$1",[s.mappingId]))[0];
      expect(row.fidelity).toBe("EXACT");
      expect(row.evidence.kidSha256).toBe(hash);
      expect(row.evidence.brokerSnapshot.broker).toBe(broker);
      expect(row.evidence.listingEvidence.currency).toBe("GBP");
      const audit=await sql.unsafe("SELECT metadata FROM audit_events WHERE action='instrument-mapping.promoted' AND entity_id=$1",[s.mappingId]);
      expect(audit).toHaveLength(1);
      expect(audit[0].metadata.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(audit[0].metadata.evidence.kidSha256).toBe(hash);
    });
  });

  it("answers an unknown mapping with 404",async()=>{
    const s=await seed();
    const result=await promote({...s,mappingId:crypto.randomUUID()});
    expect(result.status).toBe(404);
  });
});
