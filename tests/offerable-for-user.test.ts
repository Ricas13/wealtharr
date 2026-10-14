import { describe,expect,it } from "vitest";
import { isOfferableForUser,STARTABLE_WRAPPERS } from "@/domain/explore-catalogue";
import { assessStrategyMarket,type VerifiedCandidate } from "@/domain/strategy/market-eligibility";

const asOf="2026-10-09";
const config={allocations:[
  {exposure:"US_EQUITY_3X_LONG",weight:"0.55"},
  {exposure:"LONG_TREASURY_3X_LONG",weight:"0.45"}
]};
function m(exposure:string,ticker:string,country:string,wrapper:string,currency:string,broker:string|null=null):VerifiedCandidate{
  return {
    id:ticker,economicExposure:exposure,leverage:"3",direction:"LONG",country,wrapper,broker,
    preferredCurrency:currency,fidelity:"EXACT",effectiveFrom:"2026-01-01",effectiveTo:null,
    tradingLineId:ticker,tradingLineCurrency:currency,tradingLineEffectiveFrom:"2026-01-01",tradingLineEffectiveTo:null,
    ticker,exchange:"NYSE"
  };
}
const legs=(country:string,wrapper:string,currency:string,broker:string|null=null,tag="")=>[
  m("US_EQUITY_3X_LONG","E"+tag+country+wrapper,country,wrapper,currency,broker),
  m("LONG_TREASURY_3X_LONG","T"+tag+country+wrapper,country,wrapper,currency,broker)
];
const strategy={engine:"FIXED_ALLOCATION",config,supportedRegions:[] as string[],supportedWrappers:[] as string[]};
const offer=(mappings:VerifiedCandidate[],userMarket:{country:string;currency:string;broker?:string|null;wrapper?:string|null},s=strategy)=>
  isOfferableForUser({strategy:s,userMarket,mappings,asOf});

describe("isOfferableForUser",()=>{
  it("offers a strategy mapped for the user's own GB/ISA market",()=>{
    const result=offer(legs("GB","ISA","GBP"),{country:"GB",currency:"GBP"});
    expect(result.offerable).toBe(true);
    expect(result.wrapper).toBe("ISA");
  });

  it("hides a strategy mapped only for US/TAXABLE from a GB user, even though a market exists elsewhere",()=>{
    const mappings=legs("US","TAXABLE","USD");
    const result=offer(mappings,{country:"GB",currency:"GBP"});
    expect(result.offerable).toBe(false);
    // The old check (`supportedMarkets.length>0`) would have shown this card.
    expect(result.assessment?.supportedMarkets.length).toBeGreaterThan(0);
    expect(offer(mappings,{country:"US",currency:"USD"}).offerable).toBe(true);
  });

  it("does not hard-code ISA: a GB user with only a TAXABLE or SIPP mapping is still offered it",()=>{
    expect(offer(legs("GB","TAXABLE","GBP"),{country:"GB",currency:"GBP"})).toMatchObject({offerable:true,wrapper:"TAXABLE"});
    expect(offer(legs("GB","SIPP","GBP"),{country:"GB",currency:"GBP"})).toMatchObject({offerable:true,wrapper:"SIPP"});
  });

  it("only considers wrappers the strategy supports, and a wrapper the user already chose",()=>{
    const mappings=legs("GB","TAXABLE","GBP");
    expect(offer(mappings,{country:"GB",currency:"GBP"},{...strategy,supportedWrappers:["ISA"]}).offerable).toBe(false);
    expect(offer(mappings,{country:"GB",currency:"GBP",wrapper:"ISA"}).offerable).toBe(false);
    expect(offer(mappings,{country:"GB",currency:"GBP",wrapper:"TAXABLE"}).offerable).toBe(true);
    expect(STARTABLE_WRAPPERS).toEqual(["ISA","SIPP","TAXABLE"]);
  });

  it("respects supported regions",()=>{
    const mappings=legs("GB","ISA","GBP");
    expect(offer(mappings,{country:"GB",currency:"GBP"},{...strategy,supportedRegions:["US"]}).offerable).toBe(false);
  });

  it("requires a matching broker for broker-specific mappings, as createStrategy does",()=>{
    const mappings=legs("GB","ISA","GBP","Broker X");
    expect(offer(mappings,{country:"GB",currency:"GBP"}).offerable).toBe(false);
    expect(offer(mappings,{country:"GB",currency:"GBP",broker:"Broker Y"}).offerable).toBe(false);
    expect(offer(mappings,{country:"GB",currency:"GBP",broker:"Broker X"}).offerable).toBe(true);
  });

  it("rejects a currency mismatch",()=>{
    expect(offer(legs("GB","ISA","GBP"),{country:"GB",currency:"USD"}).offerable).toBe(false);
  });

  it("rejects partial legs, never offering one mapped leg",()=>{
    const partial=[legs("GB","ISA","GBP")[0]];
    expect(offer(partial,{country:"GB",currency:"GBP"}).offerable).toBe(false);
  });

  it("fails closed on missing coordinates",()=>{
    const mappings=legs("GB","ISA","GBP");
    expect(offer(mappings,{country:"",currency:"GBP"}).offerable).toBe(false);
    expect(offer(mappings,{country:"GB",currency:""}).offerable).toBe(false);
    expect(offer(mappings,{country:"GB",currency:"GBP",broker:"  "}).offerable).toBe(false);
    expect(offer([],{country:"GB",currency:"GBP"}).offerable).toBe(false);
  });

  it("agrees with the createStrategy predicate (assessStrategyMarket.available) for every wrapper",()=>{
    const mappings=[...legs("GB","ISA","GBP",null,"a"),...legs("US","TAXABLE","USD","BrokerZ","b"),legs("GB","SIPP","GBP",null,"c")[0]];
    const users=[
      {country:"GB",currency:"GBP",broker:null},{country:"GB",currency:"USD",broker:null},
      {country:"US",currency:"USD",broker:null},{country:"US",currency:"USD",broker:"BrokerZ"}
    ];
    for(const user of users){
      const expected=STARTABLE_WRAPPERS.some(wrapper=>
        assessStrategyMarket(strategy.engine,config,mappings,{...user,wrapper},asOf).available);
      expect(offer(mappings,user).offerable,JSON.stringify(user)).toBe(expected);
    }
  });
});
