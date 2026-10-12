import {describe,expect,it} from "vitest";
import {existsSync,readdirSync,readFileSync} from "node:fs";
import {RESEARCH_STRATEGIES,LEVERAGE_DISCLOSURE,type StrategyProfile} from "@/domain/strategy/research-catalog";
import {STRATEGY_PLUGINS,curatedRelease,curatedReleaseForVersion,getStrategyPlugin,isBuiltInStrategy} from "@/domain/strategy/catalog";
import {assertCuratedRules,CANONICAL_9SIG_CONFIG,CANONICAL_9SIG_V1_1_CONFIG} from "@/domain/strategy/curated-release";
import {CANONICAL_9SIG_CONFIG as PLUGIN_9SIG_CONFIG} from "@/domain/strategy/catalog/9sig";

/**
 * Refactor safety net for the strategy plugin registry (catalog/<key>.ts).
 *
 * HOW THESE VALUES WERE DERIVED: this file was written WITHOUT being able to execute anything
 * (no Node toolchain in the authoring environment). PRE_REFACTOR_PROFILES below is a verbatim
 * text copy of the `RESEARCH_STRATEGIES` array, the `fixed` helper and `LEVERAGE_DISCLOSURE` from
 * `src/domain/strategy/research-catalog.ts` at commit f840e26 (taken with `git show`, only the
 * three identifiers renamed with a PRE_REFACTOR_ prefix). The literal tables further down
 * (ENGINE_AND_CONFIG, SEED_DEFINITIONS, CANONICAL_9SIG_LITERAL) were written by hand from
 * `scripts/seed.ts` and the profiles at that commit. This test has NEVER been run; the first run
 * should happen in CI. A rule change is a new immutable version: when this test fails, do not edit
 * the pins to match, ask why published rules moved.
 */

// ---- verbatim pre-refactor definitions (commit f840e26) -------------------------------------
const fixed = (allocations: [string,string][], frequency:"MONTHLY"|"QUARTERLY"|"ANNUAL") => ({
  allocations: allocations.map(([exposure,weight])=>({exposure,weight})),
  reviewFrequency:frequency,
  rebalanceThreshold:"0.00"
});
const PRE_REFACTOR_LEVERAGE_DISCLOSURE =
  "This strategy holds leveraged products that reset their leverage every day. Because of that reset, returns over longer periods can differ sharply from the stated multiple of the index, and losses can compound in volatile or falling markets (volatility decay). They can fall a great deal in a short time and are unsuitable for many investors. Rules-based calculation only, not individual investment advice; past performance is not a guide to the future.";
const PRE_REFACTOR_PROFILES: readonly StrategyProfile[] = [
  {
    key:"hfea",name:"Hedgefundie Excellent Adventure (classic)",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",disclosure:PRE_REFACTOR_LEVERAGE_DISCLOSURE,
    config:{
      ...fixed([["US_EQUITY_3X_LONG","0.55"],["LONG_TREASURY_3X_LONG","0.45"]],"QUARTERLY"),
      reviewSchedule:"CALENDAR_QUARTER_END",
      reviewTimezone:"America/New_York",
      reviewCutoffLocal:"16:00",
      marketHolidays:[]
    },
    rules:"Target 55% 3x S&P 500 (UPRO) and 45% 3x long-duration US Treasuries (TMF); rebalance on quarter reviews. TQQQ is NOT the original HFEA stock leg.",
    research:["https://www.reddit.com/r/LETFs/comments/r25c3n/","https://www.reddit.com/r/LETFs/comments/pkkoao/"],
    risks:["Daily leverage resets and path dependency","Bonds and equities can fall together","UK ISA/UCITS substitutions must not be assumed equivalent"]
  },
  {
    key:"golden-butterfly",name:"Golden Butterfly",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_LARGE_CAP","0.20"],["US_SMALL_CAP_VALUE","0.20"],["LONG_TREASURY","0.20"],["SHORT_TREASURY","0.20"],["GOLD","0.20"]],"ANNUAL"),
    rules:"Five 20% sleeves: large-cap stocks, small-cap value stocks, long Treasuries, short Treasuries, gold. Annual review/rebalance is a configurable profile, not a claim about the only canonical schedule.",
    research:["https://portfoliocharts.com/portfolios/golden-butterfly-portfolio/"],
    risks:["US factor/instrument mapping varies by jurisdiction","Gold implementation and fees vary"]
  },
  {
    key:"permanent-portfolio",name:"Permanent Portfolio",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["BROAD_EQUITY","0.25"],["LONG_TREASURY","0.25"],["CASH_BILLS","0.25"],["GOLD","0.25"]],"ANNUAL"),
    rules:"Harry Browne style equal quarters in stocks, long government bonds, cash or T-bills, and gold. Threshold bands are variants and require explicit versioning.",
    research:["https://portfoliocharts.com/portfolios/permanent-portfolio/"],
    risks:["Interest-rate/inflation exposure","Cash sleeve and home-currency choices matter"]
  },
  {
    key:"all-weather",name:"All Weather (unlevered reference)",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["BROAD_EQUITY","0.30"],["LONG_TREASURY","0.40"],["INTERMEDIATE_TREASURY","0.15"],["GOLD","0.075"],["BROAD_COMMODITIES","0.075"]],"ANNUAL"),
    rules:"Commonly circulated unlevered 30/40/15/7.5/7.5 All Weather approximation; NOT an official, single canonical Ray Dalio product or risk-parity implementation.",
    research:["https://portfoliocharts.com/portfolios/all-seasons-portfolio/"],
    risks:["Commodities and tax-wrapper availability","Allocation differs from true risk parity"]
  },
  {
    key:"three-fund",name:"Three-Fund Portfolio — 40/40/20 model",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["DOMESTIC_EQUITY","0.40"],["INTERNATIONAL_EQUITY","0.40"],["AGGREGATE_BONDS","0.20"]],"ANNUAL"),
    rules:"A fixed 40/40/20 three-fund reference model; this is not a universal Bogleheads allocation. Other splits require separate named versions.",
    research:["https://www.bogleheads.org/wiki/Three-fund_portfolio"],risks:["Home bias","Bond duration and currency"]
  },
  {
    key:"60-40",name:"60/40 Portfolio",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["BROAD_EQUITY","0.60"],["AGGREGATE_BONDS","0.40"]],"ANNUAL"),
    rules:"Fixed 60% diversified equities and 40% bonds; annual calendar review. Alternative rebalancing thresholds are separately versioned models.",
    research:["https://www.bogleheads.org/wiki/Asset_allocation"],risks:["Stock-bond correlations can change"]
  },
  {
    key:"80-20",name:"80/20 Portfolio",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["BROAD_EQUITY","0.80"],["AGGREGATE_BONDS","0.20"]],"ANNUAL"),
    rules:"80% diversified equities and 20% bonds; review annually.",
    research:["https://www.bogleheads.org/wiki/Asset_allocation"],risks:["High equity drawdown potential"]
  },
  {
    key:"buffett-90-10",name:"Buffett 90/10 Portfolio",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_LARGE_CAP","0.90"],["SHORT_TREASURY","0.10"]],"ANNUAL"),
    rules:"90% low-cost S&P 500 exposure and 10% short-term US government bonds. Annual rebalance is this model's convention, not a Buffett-mandated schedule.",
    research:["https://www.berkshirehathaway.com/letters/2013ltr.pdf"],risks:["US-equity concentration","Bond maturity and regional instrument fidelity"]
  },
  {
    key:"coffeehouse",name:"Coffeehouse Portfolio — US seven-fund reference",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_LARGE_CAP","0.10"],["US_LARGE_CAP_VALUE","0.10"],["US_SMALL_CAP_BLEND","0.10"],
      ["US_SMALL_CAP_VALUE","0.10"],["DEVELOPED_EX_US_LARGE_CAP","0.10"],
      ["US_INTERMEDIATE_TREASURY","0.40"],["US_REITS","0.10"]],"ANNUAL"),
    rules:"Bill Schultheis seven-fund US reference: 10% each in large blend/value, small blend/value, developed ex-US and US REITs, plus 40% US intermediate Treasuries. Annual review is an explicit platform convention, not an author-mandated universal rule.",
    research:["https://portfoliocharts.com/portfolios/coffeehouse-portfolio/"],
    risks:["UK fund equivalence and value-factor fidelity","US REIT tax/availability","Intermediate Treasury duration"]
  },
  {
    key:"core-four",name:"Four-Fund Stocks/Bonds/REIT Reference (Core Four research)",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_TOTAL_EQUITY","0.48"],["TOTAL_EX_US_EQUITY","0.24"],
      ["US_AGGREGATE_BONDS","0.20"],["US_REITS","0.08"]],"ANNUAL"),
    rules:"An explicit 80/20 four-fund research split based on the asset classes on Rick Ferri's official Classic Core-4 website: 48% total US stocks, 24% total international equities, 20% US investment-grade aggregate bonds and 8% US REITs. Not an officially endorsed or licensed product; the 80/20 allocation is one separate version.",
    research:["https://core-4.com/classic-core-4-portfolio/","https://core-4.com/classic-core-4-portfolio-allocations/","https://portfoliocharts.com/portfolios/core-four-portfolio/"],
    risks:["Core-4 is a registered trade mark: commercial name/licence clearance required","Bond universe must include credit and MBS rather than only Treasuries","UK fund eligibility, currencies and REIT coverage"]
  },
  {
    key:"swensen",name:"Swensen Lazy Portfolio — six-asset US reference",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    config:fixed([["US_TOTAL_EQUITY","0.30"],["DEVELOPED_EX_US_LARGE_CAP","0.15"],
      ["EMERGING_MARKETS_EQUITY","0.05"],["US_REITS","0.20"],
      ["US_INTERMEDIATE_TREASURY","0.15"],["US_TIPS","0.15"]],"ANNUAL"),
    rules:"David Swensen's individual-investor six-asset reference: 30% US equity, 15% developed foreign, 5% emerging, 20% US REITs, 15% US Treasuries and 15% US TIPS. This is not Yale endowment allocation; exact Treasury-duration implementation must be independently approved.",
    research:["https://www.bogleheads.org/blog/2021/01/02/david-swensens-portfolio-from-unconventional-success-2020-update/"],
    risks:["Interest-rate and inflation-linked Treasury risk","Emerging markets","US REIT and UK wrapper availability"]
  },
  {
    key:"merriman-ultimate",name:"Merriman Ultimate Buy-and-Hold",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Paul Merriman multi-factor asset sleeves need complete versioned weights, exchange instruments and tests.",
    research:["https://www.paulmerriman.com/"],risks:["Many sleeves and dealing costs"]
  },
  {
    key:"income-sig",name:"Income Sig (Jason Kelly)",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Official quarterly Income Sig leveraged allocation and surplus-skimming methodology; exact weights, reserve management and all reset rules must be verified from the author's materials.",
    research:["https://jasonkelly.com/"],risks:["Daily-reset leverage","Proprietary licensed rules","High downside risk"]
  },
  {
    key:"two-funds-for-life",name:"Two Funds for Life (Paul Merriman)",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Merriman's two-fund lifetime allocation between S&P 500 and small-cap value; age adjustments, instrument rules and rebalancing need source-specific testing.",
    research:["https://www.paulmerriman.com/"],risks:["Style and size tilt","Fund universe and tax wrapper restrictions"]
  },
  {
    key:"bernstein-no-brainer",name:"Bernstein No-Brainer Portfolio",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"William Bernstein inspired diversified US and international stock sleeves and short government bonds; verify published weights and dates before release.",
    research:["https://www.bogleheads.org/wiki/Lazy_portfolios"],risks:["Equity risk","Regional duration, currency and instrument fidelity"]
  },
  {
    key:"larry-portfolio",name:"Larry Portfolio",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Larry Swedroe's factor-oriented equity and fixed-income model; multiple named historical variants require strict identification.",
    research:["https://portfoliocharts.com/portfolios/"],risks:["Small/value factor implementation","Duration exposure","Fidelity of available ETFs"]
  },
  {
    key:"pinwheel",name:"Pinwheel Portfolio",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Portfolio Charts Pinwheel multi-asset reference; verify the entire original asset allocation and international fund translation.",
    research:["https://portfoliocharts.com/portfolios/"],risks:["Multi-asset rebalancing and tax","Home-country exposure mapping"]
  },
  {
    key:"trinity",name:"Trinity Portfolio (Meb Faber)",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"A named Trinity Portfolio version must specify allocation, momentum timing and cash rules; do not blend static and tactical implementations.",
    research:["https://mebfaber.com/"],risks:["Timing implementation differences","Model data/licensing requirements"]
  },
  {
    key:"trend-200d",name:"200-Day Moving Average Trend",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"A versioned 200-day closing-price trend-following method; universe, signal-day convention, defensive asset, and adjusted-price policy must be fixed and verified.",
    research:["https://mebfaber.com/"],risks:["Whipsaw","Corporate actions and trading calendars","False signals on unadjusted quotes"]
  },
  {
    key:"risk-parity",name:"Risk Parity (rules-based reference)",engine:"RESEARCH_PENDING",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Risk-parity is a method family rather than one fixed allocation: publish a specific public methodology with lookback windows, covariance settings and rebalance rules.",
    research:["https://portfoliocharts.com/portfolios/"],risks:["Leverage and covariance instability","Ambiguous reference implementation"]
  },
  {
    key:"dual-momentum",name:"Global Dual Momentum",engine:"MOMENTUM_ROTATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Compare specified equity assets over a versioned 12-month lookback; select the relative winner only if its absolute return exceeds the explicitly configured defensive hurdle, otherwise hold defensive assets. Review monthly. Exact universes, signals, lookback, end-of-month convention and defensive asset MUST be explicit.",
    research:["https://www.optimalmomentum.com/global-equities-momentum/"],risks:["Whipsaws","Look-ahead bias","Missing historical data must block trades"]
  },
  {
    key:"gtaa-ivy",name:"GTAA / Ivy",engine:"MOMENTUM_ROTATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Define the exact Faber-style 10-month moving-average timing universe and cash rules, then evaluate monthly. Variants are separate immutable strategy versions.",
    research:["https://mebfaber.com/2007/06/"],
    risks:["Return series and dividend adjustments","No universal GTAA specification"]
  },
  {
    key:"paa",name:"Protective Asset Allocation",engine:"MOMENTUM_ROTATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Requires exact published PAA risk and protection universes, momentum metrics, breadth rules and protection allocation; not safely represented by generic relative momentum.",
    research:["https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2759734"],risks:["Complex regime/breadth calculations"]
  },
  {
    key:"vaa",name:"Vigilant Asset Allocation",engine:"MOMENTUM_ROTATION",launchState:"DRAFT_REQUIRES_VERIFICATION",
    rules:"Requires exact VAA offensive/defensive universes and multi-horizon momentum scoring; distinct from PAA.",
    research:["https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3002624"],risks:["Whipsaw","Trading-calendar precision"]
  },
  ...(["3sig","6sig"] as const).map(key=>({
    key,name:key.toUpperCase()+" (research pending)",engine:"RESEARCH_PENDING" as const,launchState:"DRAFT_REQUIRES_VERIFICATION" as const,
    rules:"Do not infer "+key+" parameters by renaming the 9Sig engine. Verify the source book's target growth, signal frequency, bands, cash management and reset rules before publication.",
    research:["https://jasonkelly.com/2017/01/how-my-signal-system-works/","https://jasonkelly.com/books/3sig/","https://jasonkelly.com/"], risks:["Proprietary method ambiguity","Version-specific interpretation"]
  }))
];
// ---------------------------------------------------------------------------------------------

const pairs=(rows:[string,string][])=>rows.map(([exposure,weight])=>({exposure,weight}));
const annual={reviewFrequency:"ANNUAL",rebalanceThreshold:"0.00"};

/** Hand-written, data-level pins of every strategy's engine and executable config. */
const ENGINE_AND_CONFIG:Record<string,{engine:string;config?:Record<string,unknown>}>={
  hfea:{engine:"FIXED_ALLOCATION",config:{
    allocations:pairs([["US_EQUITY_3X_LONG","0.55"],["LONG_TREASURY_3X_LONG","0.45"]]),
    reviewFrequency:"QUARTERLY",rebalanceThreshold:"0.00",
    reviewSchedule:"CALENDAR_QUARTER_END",reviewTimezone:"America/New_York",reviewCutoffLocal:"16:00",marketHolidays:[]
  }},
  "golden-butterfly":{engine:"FIXED_ALLOCATION",config:{...annual,allocations:pairs([
    ["US_LARGE_CAP","0.20"],["US_SMALL_CAP_VALUE","0.20"],["LONG_TREASURY","0.20"],["SHORT_TREASURY","0.20"],["GOLD","0.20"]])}},
  "permanent-portfolio":{engine:"FIXED_ALLOCATION",config:{...annual,allocations:pairs([
    ["BROAD_EQUITY","0.25"],["LONG_TREASURY","0.25"],["CASH_BILLS","0.25"],["GOLD","0.25"]])}},
  "all-weather":{engine:"FIXED_ALLOCATION",config:{...annual,allocations:pairs([
    ["BROAD_EQUITY","0.30"],["LONG_TREASURY","0.40"],["INTERMEDIATE_TREASURY","0.15"],["GOLD","0.075"],["BROAD_COMMODITIES","0.075"]])}},
  "three-fund":{engine:"FIXED_ALLOCATION",config:{...annual,allocations:pairs([
    ["DOMESTIC_EQUITY","0.40"],["INTERNATIONAL_EQUITY","0.40"],["AGGREGATE_BONDS","0.20"]])}},
  "60-40":{engine:"FIXED_ALLOCATION",config:{...annual,allocations:pairs([["BROAD_EQUITY","0.60"],["AGGREGATE_BONDS","0.40"]])}},
  "80-20":{engine:"FIXED_ALLOCATION",config:{...annual,allocations:pairs([["BROAD_EQUITY","0.80"],["AGGREGATE_BONDS","0.20"]])}},
  "buffett-90-10":{engine:"FIXED_ALLOCATION",config:{...annual,allocations:pairs([["US_LARGE_CAP","0.90"],["SHORT_TREASURY","0.10"]])}},
  coffeehouse:{engine:"FIXED_ALLOCATION",config:{...annual,allocations:pairs([
    ["US_LARGE_CAP","0.10"],["US_LARGE_CAP_VALUE","0.10"],["US_SMALL_CAP_BLEND","0.10"],["US_SMALL_CAP_VALUE","0.10"],
    ["DEVELOPED_EX_US_LARGE_CAP","0.10"],["US_INTERMEDIATE_TREASURY","0.40"],["US_REITS","0.10"]])}},
  "core-four":{engine:"FIXED_ALLOCATION",config:{...annual,allocations:pairs([
    ["US_TOTAL_EQUITY","0.48"],["TOTAL_EX_US_EQUITY","0.24"],["US_AGGREGATE_BONDS","0.20"],["US_REITS","0.08"]])}},
  swensen:{engine:"FIXED_ALLOCATION",config:{...annual,allocations:pairs([
    ["US_TOTAL_EQUITY","0.30"],["DEVELOPED_EX_US_LARGE_CAP","0.15"],["EMERGING_MARKETS_EQUITY","0.05"],
    ["US_REITS","0.20"],["US_INTERMEDIATE_TREASURY","0.15"],["US_TIPS","0.15"]])}},
  "merriman-ultimate":{engine:"RESEARCH_PENDING"},
  "income-sig":{engine:"RESEARCH_PENDING"},
  "two-funds-for-life":{engine:"RESEARCH_PENDING"},
  "bernstein-no-brainer":{engine:"RESEARCH_PENDING"},
  "larry-portfolio":{engine:"RESEARCH_PENDING"},
  pinwheel:{engine:"RESEARCH_PENDING"},
  trinity:{engine:"RESEARCH_PENDING"},
  "trend-200d":{engine:"RESEARCH_PENDING"},
  "risk-parity":{engine:"RESEARCH_PENDING"},
  "dual-momentum":{engine:"MOMENTUM_ROTATION"},
  "gtaa-ivy":{engine:"MOMENTUM_ROTATION"},
  paa:{engine:"MOMENTUM_ROTATION"},
  vaa:{engine:"MOMENTUM_ROTATION"},
  "3sig":{engine:"RESEARCH_PENDING"},
  "6sig":{engine:"RESEARCH_PENDING"}
};

const CANONICAL_9SIG_LITERAL={
  targetExposure:"NASDAQ_100_3X_LONG",initialTargetRatio:"0.60",targetRate:"0.09",contributionTargetRatio:"0.50",
  maxCashUse:"0.90",tolerance:"0.01",reviewFrequency:"QUARTERLY",reviewCutoffLocal:"16:00",
  businessDayConvention:"PREVIOUS",marketHolidays:[]
};
/** 9Sig 1.1, written by hand from docs/strategy-specs/9sig.md (added with the 1.1 release). */
const CANONICAL_9SIG_V1_1_LITERAL={
  targetExposure:"NASDAQ_100_3X_LONG",methodRevision:"KELLY_SIGNAL_2026_10",
  initialTargetRatio:"0.60",targetRate:"0.09",contributionTargetRatio:"0.50",
  reviewBuyCapRatio:"0.90",tolerance:"0",reviewFrequency:"QUARTERLY",reviewSchedule:"CALENDAR_QUARTER_END",
  reviewTimezone:"America/New_York",reviewCutoffLocal:"16:00",businessDayConvention:"PREVIOUS",marketHolidays:[]
};

type SeedPin={name:string;family:string;description:string;engine:string;proprietary:boolean;enabled:boolean;
  initialVersion:"PUBLISHED"|"DRAFT"|null;realign:boolean};
/**
 * What scripts/seed.ts inserted at f840e26, in that script's own order (registry order differs
 * only in the order of independent rows). Regions and wrappers were literal empty arrays for all.
 */
const SEED_DEFINITIONS:Record<string,SeedPin>={
  "9sig":{name:"9Sig",family:"SIGNAL_VALUE_TARGET",description:"Rules-based value target strategy",engine:"VALUE_TARGET",proprietary:true,enabled:true,initialVersion:"PUBLISHED",realign:false},
  hfea:{name:"HFEA",family:"FIXED_ALLOCATION",description:"Leveraged fixed-allocation strategy",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,initialVersion:"DRAFT",realign:false},
  "golden-butterfly":{name:"Golden Butterfly",family:"FIXED_ALLOCATION",description:"Diversified fixed-allocation strategy",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,initialVersion:"DRAFT",realign:false},
  "three-fund":{name:"Three-Fund Portfolio — 40/40/20 model",family:"FIXED_ALLOCATION",description:"Named fixed-allocation strategy",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,initialVersion:"DRAFT",realign:false},
  "60-40":{name:"60/40 Portfolio",family:"FIXED_ALLOCATION",description:"Named fixed-allocation strategy",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,initialVersion:"DRAFT",realign:false},
  "80-20":{name:"80/20 Portfolio",family:"FIXED_ALLOCATION",description:"Named fixed-allocation strategy",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,initialVersion:"DRAFT",realign:false},
  "permanent-portfolio":{name:"Permanent Portfolio",family:"FIXED_ALLOCATION",description:"Four equal asset sleeves",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,initialVersion:"DRAFT",realign:false},
  "all-weather":{name:"All Weather (reference)",family:"FIXED_ALLOCATION",description:"Published unlevered reference approximation",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,initialVersion:"DRAFT",realign:false},
  "buffett-90-10":{name:"Buffett 90/10 Portfolio",family:"FIXED_ALLOCATION",description:"Fixed 90/10 reference model",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,initialVersion:"DRAFT",realign:false},
  coffeehouse:{name:"Coffeehouse Portfolio — US seven-fund reference",family:"FIXED_ALLOCATION",description:"Research-only seven-asset profile",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,initialVersion:"DRAFT",realign:true},
  "core-four":{name:"Four-Fund Stocks/Bonds/REIT Reference",family:"FIXED_ALLOCATION",description:"Research-only four-asset profile; source name requires brand licensing",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,initialVersion:"DRAFT",realign:true},
  swensen:{name:"Swensen Lazy Portfolio — US reference",family:"FIXED_ALLOCATION",description:"Research-only six-asset profile",engine:"FIXED_ALLOCATION",proprietary:false,enabled:false,initialVersion:"DRAFT",realign:true},
  "gtaa-ivy":{name:"GTAA / Ivy",family:"MOMENTUM",description:"Research pending",engine:"MOMENTUM_ROTATION",proprietary:false,enabled:false,initialVersion:null,realign:false},
  paa:{name:"Protective Asset Allocation",family:"MOMENTUM",description:"Research pending",engine:"MOMENTUM_ROTATION",proprietary:false,enabled:false,initialVersion:null,realign:false},
  vaa:{name:"Vigilant Asset Allocation",family:"MOMENTUM",description:"Research pending",engine:"MOMENTUM_ROTATION",proprietary:false,enabled:false,initialVersion:null,realign:false},
  "dual-momentum":{name:"Dual Momentum",family:"MOMENTUM",description:"Momentum rotation strategy",engine:"MOMENTUM_ROTATION",proprietary:false,enabled:false,initialVersion:null,realign:false}
};

const canonical=(value:unknown):string=>JSON.stringify((function walk(v:unknown):unknown{
  if(Array.isArray(v))return v.map(walk);
  if(v&&typeof v==="object")
    return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,walk(x)]));
  return v;
})(value));

const CATALOG_DIR="src/domain/strategy/catalog";

describe("strategy plugin registry preserves the pre-refactor catalogue",()=>{
  it("keeps the exact registry order of the old RESEARCH_STRATEGIES array",()=>{
    expect(RESEARCH_STRATEGIES.map(p=>p.key)).toEqual(PRE_REFACTOR_PROFILES.map(p=>p.key));
    expect(RESEARCH_STRATEGIES).toHaveLength(26);
  });

  it("every derived profile is deep-equal to the verbatim pre-refactor profile",()=>{
    expect(RESEARCH_STRATEGIES).toEqual(PRE_REFACTOR_PROFILES);
  });

  it("pins engine and normalised executable config of every strategy at data level",()=>{
    expect(Object.keys(ENGINE_AND_CONFIG)).toEqual(RESEARCH_STRATEGIES.map(p=>p.key));
    for(const profile of RESEARCH_STRATEGIES){
      const pin=ENGINE_AND_CONFIG[profile.key];
      expect(profile.engine,profile.key).toBe(pin.engine);
      if(pin.config===undefined)expect(profile.config,profile.key).toBeUndefined();
      else{
        expect(profile.config,profile.key).toEqual(pin.config);
        expect(canonical(profile.config),profile.key).toBe(canonical(pin.config));
      }
      expect(profile.launchState,profile.key).toBe("DRAFT_REQUIRES_VERIFICATION");
    }
  });

  it("keeps input schemas and disclosure text exactly as before",()=>{
    expect(LEVERAGE_DISCLOSURE).toBe(PRE_REFACTOR_LEVERAGE_DISCLOSURE);
    for(const profile of RESEARCH_STRATEGIES){
      expect(profile.inputSchema,profile.key).toBeUndefined();
      if(profile.key==="hfea")expect(profile.disclosure).toBe(PRE_REFACTOR_LEVERAGE_DISCLOSURE);
      else expect(profile.disclosure,profile.key).toBeUndefined();
    }
  });

  it("keeps the canonical 9Sig configuration byte-for-byte and importable from both paths",()=>{
    expect(CANONICAL_9SIG_CONFIG).toEqual(CANONICAL_9SIG_LITERAL);
    expect(canonical(CANONICAL_9SIG_CONFIG)).toBe(canonical(CANONICAL_9SIG_LITERAL));
    expect(PLUGIN_9SIG_CONFIG).toBe(CANONICAL_9SIG_CONFIG);
    const nine=getStrategyPlugin("9sig")!;
    expect(nine.profile).toBeNull();
    expect(curatedRelease(nine)).toMatchObject({engine:"VALUE_TARGET",inputSchema:undefined,disclosure:undefined});
    expect(curatedRelease(nine)?.config).toBe(CANONICAL_9SIG_CONFIG);
    expect(curatedRelease(nine)?.summary).toBe(
      "Quarterly signal-based value targeting; full source-methodology audit remains outstanding.");
    expect(RESEARCH_STRATEGIES.some(p=>p.key==="9sig")).toBe(false);
  });

  it("adds 9Sig 1.1 as a separate, version-bound DRAFT release and leaves 1.0 untouched",()=>{
    const nine=getStrategyPlugin("9sig")!;
    const later=nine.codeRelease?.laterVersions??[];
    expect(later.map(v=>v.version)).toEqual(["1.1"]);
    expect(later[0].config).toBe(CANONICAL_9SIG_V1_1_CONFIG);
    expect(CANONICAL_9SIG_V1_1_CONFIG).toEqual(CANONICAL_9SIG_V1_1_LITERAL);
    expect(canonical(CANONICAL_9SIG_V1_1_CONFIG)).toBe(canonical(CANONICAL_9SIG_V1_1_LITERAL));
    expect(later[0].effectiveFrom).not.toBe("2026-01-01");
    expect(later[0].disclosure).toBe(PRE_REFACTOR_LEVERAGE_DISCLOSURE);
    expect(curatedReleaseForVersion(nine,"1.1")?.config).toBe(CANONICAL_9SIG_V1_1_CONFIG);
    expect(curatedReleaseForVersion(nine,"1.0")?.config).toBe(CANONICAL_9SIG_CONFIG);
    expect(curatedReleaseForVersion(nine,undefined)?.config).toBe(CANONICAL_9SIG_CONFIG);
    expect(()=>assertCuratedRules("9sig","VALUE_TARGET",CANONICAL_9SIG_V1_1_LITERAL,[],"1.1")).not.toThrow();
    expect(()=>assertCuratedRules("9sig","VALUE_TARGET",CANONICAL_9SIG_V1_1_LITERAL,[])).toThrow("CURATED_STRATEGY_RULES_IMMUTABLE");
    // No other plugin declares a later release.
    expect(STRATEGY_PLUGINS.filter(p=>p.codeRelease?.laterVersions?.length).map(p=>p.key)).toEqual(["9sig"]);
    const seed=readFileSync("scripts/seed.ts","utf8");
    expect(seed).toContain("laterVersions");
    expect(seed).toMatch(/INSERT INTO strategy_versions[^;]*?'DRAFT','OPTIONAL'[^;]*?ON CONFLICT \(strategy_definition_id,version\) DO NOTHING/s);
  });

  it("curated-rule enforcement accepts exactly the pinned rules and nothing else",()=>{
    expect(()=>assertCuratedRules("9sig","VALUE_TARGET",CANONICAL_9SIG_LITERAL,[])).not.toThrow();
    for(const [key,pin] of Object.entries(ENGINE_AND_CONFIG)){
      if(pin.config&&pin.engine!=="RESEARCH_PENDING"){
        expect(()=>assertCuratedRules(key,pin.engine,pin.config,[]),key).not.toThrow();
        expect(()=>assertCuratedRules(key,"VALUE_TARGET",pin.config,[]),key).toThrow("CURATED_STRATEGY_RULES_IMMUTABLE");
        expect(()=>assertCuratedRules(key,pin.engine,{...pin.config,rebalanceThreshold:"0.05"},[]),key).toThrow("CURATED_STRATEGY_RULES_IMMUTABLE");
      }else{
        expect(()=>assertCuratedRules(key,pin.engine,pin.config??{},[]),key).toThrow("CURATED_STRATEGY_NOT_VERIFIED");
      }
    }
    expect(()=>assertCuratedRules("not-a-strategy","FIXED_ALLOCATION",{},[])).toThrow("CURATED_STRATEGY_NOT_VERIFIED");
  });
});

describe("seed definitions derived from the registry equal what the seed script inserted",()=>{
  it("lists exactly the pinned seeded strategies with identical rows",()=>{
    const seeded=STRATEGY_PLUGINS.filter(p=>p.seedDefinition!==null);
    expect(seeded.map(p=>p.key).sort()).toEqual(Object.keys(SEED_DEFINITIONS).sort());
    for(const plugin of seeded){
      const d=plugin.seedDefinition!;
      const pin=SEED_DEFINITIONS[plugin.key];
      expect({name:d.name,family:d.family,description:d.description,engine:d.engine,proprietary:d.proprietary,
        enabled:d.enabled,initialVersion:d.initialVersion,realign:d.realignsResearchOnlyDefinition},plugin.key).toEqual(pin);
      expect(d.supportedRegions,plugin.key).toEqual([]);
      expect(d.supportedWrappers,plugin.key).toEqual([]);
    }
  });

  it("9Sig is the only proprietary, the only enabled-by-default and the only published-on-seed strategy",()=>{
    const seeded=STRATEGY_PLUGINS.flatMap(p=>p.seedDefinition?[{key:p.key,def:p.seedDefinition}]:[]);
    expect(seeded.filter(s=>s.def.proprietary).map(s=>s.key)).toEqual(["9sig"]);
    expect(seeded.filter(s=>s.def.enabled).map(s=>s.key)).toEqual(["9sig"]);
    expect(seeded.filter(s=>s.def.initialVersion==="PUBLISHED").map(s=>s.key)).toEqual(["9sig"]);
    expect(STRATEGY_PLUGINS[0].key).toBe("9sig");
  });

  it("only the three previously research-only fixed allocations realign an older definition",()=>{
    expect(STRATEGY_PLUGINS.filter(p=>p.seedDefinition?.realignsResearchOnlyDefinition).map(p=>p.key).sort())
      .toEqual(["coffeehouse","core-four","swensen"]);
  });

  it("keeps version 1.0 / effective 2026-01-01 and the generic fallback disclosure in the seed script",()=>{
    const seed=readFileSync("scripts/seed.ts","utf8");
    expect(seed).toContain("'1.0','2026-01-01'");
    expect(seed).toContain("Rule calculator for a user-selected strategy. Not a suitability recommendation.");
    expect(seed).toContain("ON CONFLICT (key) DO NOTHING");
  });
});

describe("plugin files are consistent with the registry",()=>{
  it("has no duplicate keys, and the registry knows every key it lists",()=>{
    const keys=STRATEGY_PLUGINS.map(p=>p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for(const key of keys)expect(isBuiltInStrategy(key),key).toBe(true);
    expect(isBuiltInStrategy("not-a-strategy")).toBe(false);
  });

  it("each plugin key equals its filename and every plugin file is registered",()=>{
    const files=readdirSync(CATALOG_DIR).filter(f=>f.endsWith(".ts")&&f!=="index.ts"&&f!=="plugin.ts")
      .map(f=>f.replace(/\.ts$/,"")).sort();
    expect(files).toEqual(STRATEGY_PLUGINS.map(p=>p.key).sort());
    for(const plugin of STRATEGY_PLUGINS){
      expect(existsSync(CATALOG_DIR+"/"+plugin.key+".ts"),plugin.key).toBe(true);
      if(plugin.profile)expect(plugin.profile.key,plugin.key).toBe(plugin.key);
      expect(Boolean(plugin.profile)!==Boolean(plugin.codeRelease),plugin.key).toBe(true);
    }
  });

  it("every non-null specCard and goldenTests path exists on disk",()=>{
    for(const plugin of STRATEGY_PLUGINS){
      if(plugin.specCard!==null){
        expect(plugin.specCard,plugin.key).toMatch(/^docs\/strategy-specs\/[a-z0-9-]+\.md$/);
        expect(existsSync(plugin.specCard),plugin.key+" specCard").toBe(true);
      }
      if(plugin.goldenTests!==null)expect(existsSync(plugin.goldenTests),plugin.key+" goldenTests").toBe(true);
    }
  });

  it("gives research-pending strategies no seed definition, spec card or golden tests",()=>{
    for(const plugin of STRATEGY_PLUGINS.filter(p=>p.profile?.engine==="RESEARCH_PENDING")){
      expect(plugin.seedDefinition,plugin.key).toBeNull();
      expect(plugin.specCard,plugin.key).toBeNull();
      expect(plugin.goldenTests,plugin.key).toBeNull();
    }
  });
});
