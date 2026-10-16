import Link from "next/link";
import type {Metadata} from "next";
import {LearningGuide} from "@/components/LearningGuide";

export const metadata:Metadata={
 title:"Portfolio Rebalancing Spreadsheet vs Automatic Tracker",
 description:"Compare spreadsheet portfolio tracking with a rule-based tracker using a practical cash, fill and review checklist. Download a free CSV template.",
 alternates:{canonical:"/learn/portfolio-tracking-spreadsheet"},
 openGraph:{title:"Portfolio Rebalancing Spreadsheet vs Tracker",url:"/learn/portfolio-tracking-spreadsheet",
 description:"A practical comparison of spreadsheet and automated portfolio records, with a downloadable CSV starter."}
};
export default function SpreadsheetPage(){
 return <LearningGuide title="Portfolio rebalancing spreadsheet vs automatic tracker"
  description="A self-directed comparison of manual spreadsheet records, review calculations and a rules-based portfolio workspace.">
  <h2>What should a portfolio spreadsheet contain?</h2>
  <p>A useful portfolio worksheet needs an investment identifier, account, currency, number of units, confirmed trade price, fees,
   cash contributions, withdrawals, and a dated target allocation. The most dangerous omission is treating a proposed trade as
   if it has already executed. Estimated quotes and actual broker fills belong in different columns or ledgers.</p>
  <h2>A worked example, without buying or selling advice</h2>
  <p>Suppose an illustrative portfolio contains £6,400 of one asset and £3,600 of another, with a chosen 60/40 target.
   The account total is £10,000, so the first target is £6,000 and the second £4,000. The differences are −£400 and +£400.
   If there is also £500 of uninvested cash, the total account value becomes £10,500 and the two targets change to
   £6,300 and £4,200. The comparisons become −£100 and +£600 before any dealing constraints or costs.</p>
  <p>These numbers illustrate a calculation. They are not investment recommendations, orders or an assessment of suitability.</p>
  <h2>Download a free CSV portfolio tracking starter</h2>
  <p><a className="button primary" href="/downloads/portfolio-tracking-template.csv" download>
   Download portfolio tracking CSV</a></p>
  <p>The file contains column headings and two clearly marked illustrative rows. Open it in Excel, LibreOffice or Google Sheets.
   It is a record-keeping template, not a real-time data feed and not a strategy engine. Replace examples with your own confirmed information.</p>
  <h2>When is a spreadsheet sufficient?</h2>
  <p>For one account and a simple, infrequently reviewed allocation, an ordinary spreadsheet may be entirely sufficient.
   You remain responsible for the data and formulas. Keeping a backup copy of the file and comparing it with your broker
   statement are good record-keeping practices.</p>
  <h2>What changes with a rules-based tracking application?</h2>
  <p>An automated workspace can store dated rules, account-specific inputs, past confirmed fills and future review dates.
   A well-designed implementation distinguishes tentative calculations from completed trades, handles revisions without
   overwriting history and reports unavailable market data rather than guessing. Wealtharr is designed for these workflows;
   individual strategies and external services remain subject to verified configuration.</p>
  <h2>A practical checking list</h2>
  <ol>
   <li>Confirm every instrument's complete identity, exchange listing and trading currency.</li>
   <li>Separate the market quote date from the actual execution timestamp.</li>
   <li>Use confirmed quantities and fees to reconcile remaining cash.</li>
   <li>Apply the selected method's review calendar rather than assuming all methods rebalance monthly.</li>
   <li>Check the result against your broker's statement before recording a transaction as complete.</li>
  </ol>
  <p><Link href="/tools/rebalance-calculator">Try the free portfolio rebalancing calculator</Link> for illustrative
   target-weight arithmetic, or <Link href="/learn/portfolio-rebalancing">read the worked guide</Link> first.</p>
 </LearningGuide>;
}
