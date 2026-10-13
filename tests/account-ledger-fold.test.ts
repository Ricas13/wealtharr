import {describe,expect,it} from "vitest";
import {foldAccountLedger,foldLedger,ledgerRowToEvent,ledgerRowsForAccount} from "@/domain/ledger";

describe("canonical strategy-account ledger partition",()=>{
  const rows=[
    {account_id:null,currency:"GBP",event_type:"CONTRIBUTION",cash_amount:"100",fee_amount:"0",instrument_id:null,quantity:"0"},
    {account_id:"acc-one",currency:"GBP",event_type:"BUY",cash_amount:"-50",fee_amount:"1",instrument_id:"etf-a",quantity:"5"},
    {account_id:"acc-two",currency:"GBP",event_type:"CONTRIBUTION",cash_amount:"250",fee_amount:"0",instrument_id:null,quantity:"0"},
    {account_id:"acc-two",currency:"GBP",event_type:"BUY",cash_amount:"-100",fee_amount:"0",instrument_id:"etf-a",quantity:"10"},
    {account_id:"acc-one",currency:"GBP",event_type:"CORRECTION",cash_amount:"50",fee_amount:"-1",instrument_id:"etf-a",quantity:"-5"}
  ];
  it("assigns legacy null-account events to primary only, never to a second account",()=>{
    expect(ledgerRowsForAccount(rows,"acc-one","acc-one")).toHaveLength(3);
    expect(ledgerRowsForAccount(rows,"acc-two","acc-one")).toHaveLength(2);
    expect(foldAccountLedger(rows,"acc-one","acc-one","GBP").cash.toString()).toBe("100");
    expect(foldAccountLedger(rows,"acc-one","acc-one","GBP").quantities.get("etf-a")?.toString()).toBe("0");
    expect(foldAccountLedger(rows,"acc-two","acc-one","GBP").cash.toString()).toBe("150");
    expect(foldAccountLedger(rows,"acc-two","acc-one","GBP").quantities.get("etf-a")?.toString()).toBe("10");
  });
  it("preserves global totals exactly without double counting or dropping reversals",()=>{
    const combined=foldLedger(rows.map(ledgerRowToEvent),"GBP");
    const primary=foldAccountLedger(rows,"acc-one","acc-one","GBP");
    const secondary=foldAccountLedger(rows,"acc-two","acc-one","GBP");
    expect(primary.cash.plus(secondary.cash).eq(combined.cash)).toBe(true);
    expect(primary.quantities.get("etf-a")!.plus(secondary.quantities.get("etf-a")!).eq(combined.quantities.get("etf-a")!)).toBe(true);
    expect(combined.cash.toString()).toBe("250");
  });
});
