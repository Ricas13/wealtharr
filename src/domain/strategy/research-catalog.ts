/**
 * Research-backed reference profiles. These are NOT automatically published:
 * regulated instruments, regional wrappers and live quotes must be verified first.
 * Allocation exposures are abstract asset classes rather than ticker guarantees.
 */
export type StrategyProfile = {
  key: string;
  name: string;
  engine: "FIXED_ALLOCATION" | "VALUE_TARGET" | "MOMENTUM_ROTATION" | "RESEARCH_PENDING";
  launchState: "DRAFT_REQUIRES_VERIFICATION";
  config?: Record<string, unknown>;
  /** Shown to the investor with the strategy; required whenever it holds a leveraged exposure. */
  disclosure?: string;
  /** Fields an investor fills in when starting the strategy (stored on the strategy version). */
  inputSchema?: Array<Record<string, unknown>>;
  rules: string;
  research: string[];
  risks: string[];
};
const fixed = (allocations: [string,string][], frequency:"MONTHLY"|"QUARTERLY"|"ANNUAL") => ({
  allocations: allocations.map(([exposure,weight])=>({exposure,weight})),
  reviewFrequency:frequency,
  rebalanceThreshold:"0.00"
});
export const LEVERAGE_DISCLOSURE =
  "This strategy holds leveraged products that reset their leverage every day. Because of that reset, returns over longer periods can differ sharply from the stated multiple of the index, and losses can compound in volatile or falling markets (volatility decay). They can fall a great deal in a short time and are unsuitable for many investors. Rules-based calculation only, not individual investment advice; past performance is not a guide to the future.";

export const RESEARCH_STRATEGIES: readonly StrategyProfile[] = [
  {
    key:"hfea",name:"Hedgefundie Excellent Adventure (classic)",engine:"FIXED_ALLOCATION",launchState:"DRAFT_REQUIRES_VERIFICATION",disclosure:LEVERAGE_DISCLOSURE,
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
