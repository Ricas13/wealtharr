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

async function seed(opts:{isin?:string|null;exposure?:string;leverage?:number;fidelity?:string;country?:string}={}){
  const isin=opts.isin===undefined?freshIsin():opts.isin;
  const inst=await sql.unsafe("INSERT INTO instruments (isin,name,economic_exposure,leverage,direction,fund_currency) VALUES ($1,$2,$3,$4,'LONG','GBP') RETURNING id",[isin,"Promo "+run,opts.exposure??"BROAD_EQUITY",opts.leverage??1]);
  const instrumentId=String(inst[0].id);instruments.push(instrumentId);
  seq+=1;
  const line=await sql.unsafe("INSERT INTO trading_lines (instrument_id,ticker,exchange,currency,exchange_timezone,effective_from) VALUES ($1,$2,'LSE','GBP','Europe/London','2026-01-01') RETURNING id",[instrumentId,"P"+run+seq]);
  const lineId=String(line[0].id);
  const country=opts.country??"GB";
  const mapping=await sql.unsafe("INSERT INTO regional_instrument_mappings (economic_exposure,leverage,direction,country,wrapper,trading_line_id,fidelity,effective_from,enabled) VALUES ($1,$2,'LONG',$3,$4,$5,$6,'2026-01-01',true) RETURNING id",[opts.exposure??"BROAD_EQUITY",opts.leverage??1,country,wrapper,lineId,opts.fidelity??"CANDIDATE"]);
  return {isin,instrumentId,lineId,mappingId:String(mapping[0].id),country};
}
const subjectOf=(s:{lineId:string;country:string})=>({economicExposure:"BROAD_EQUITY",leverage:"1",direction:"LONG",country:s.country,wrapper,tradingLineId:s.lineId});
async function put(body:unknown){
  const {PUT}=await import("@/app/api/admin/instruments/route");
  const response=await PUT(new Request(ORIGIN+"/api/admin/instruments",{method:"PUT",headers:{origin:ORIGIN,"content-type":"application/json"},body:JSON.stringify(body)}));
  return {status:response.status,body:await response.json() as Record<string,unknown>};
}
const promote=(s:{mappingId:string;isin:string|null;lineId:string;country:string},over:Record<string,unknown>={})=>put({kind:"promote",mappingId:s.mappingId,isin:s.isin,providerSymbol:null,checklist,subject:subjectOf(s),note,...over});
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

  it("answers an unknown mapping with 404",async()=>{
    const s=await seed();
    const result=await promote({...s,mappingId:crypto.randomUUID()});
    expect(result.status).toBe(404);
  });
});
