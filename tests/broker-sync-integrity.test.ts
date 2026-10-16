import {describe,expect,it} from "vitest";
import {brokerSyncDisplayStatus,confirmedLinkFingerprint} from "../src/domain/brokerage/sync-integrity";
const link={externalTradeId:"t-1",ledgerEventId:"ledger-1",side:"BUY" as const,quantity:"2.5"};
describe("broker evidence freshness",()=>{
 it("stays verified when signed evidence and permitted freshness window both match",()=>{
  const fp=confirmedLinkFingerprint([link]);
  expect(brokerSyncDisplayStatus("VERIFIED","2026-10-16T06:00:00Z",60,fp,fp,new Date("2026-10-16T06:30:00Z"))).toBe("VERIFIED");
 });
 it("expires an old successful verification, without deleting its immutable evidence",()=>{
  const fp=confirmedLinkFingerprint([link]);
  expect(brokerSyncDisplayStatus("VERIFIED","2026-10-16T04:00:00Z",60,fp,fp,new Date("2026-10-16T06:30:00Z"))).toBe("STALE");
 });
 it("requires re-verification after linked trade mutation even with the same count",()=>{
  const previous=confirmedLinkFingerprint([link]);
  const next=confirmedLinkFingerprint([{...link,quantity:"3"}]);
  expect(previous).not.toBe(next);
  expect(brokerSyncDisplayStatus("VERIFIED","2026-10-16T06:00:00Z",60,previous,next,new Date("2026-10-16T06:30:00Z"))).toBe("NEEDS_RECONCILIATION");
 });
 it("requires a fresh sync when a new link is added, a link is removed, or old snapshots lack fingerprints",()=>{
  const fp=confirmedLinkFingerprint([link]);
  const changed=confirmedLinkFingerprint([link,{...link,externalTradeId:"t-2",ledgerEventId:"ledger-2"}]);
  const now=new Date("2026-10-16T06:30:00Z");
  expect(brokerSyncDisplayStatus("VERIFIED",now,60,fp,changed,now)).toBe("NEEDS_RECONCILIATION");
  expect(brokerSyncDisplayStatus("VERIFIED",now,60,undefined,fp,now)).toBe("NEEDS_RECONCILIATION");
 });
 it("cannot convert explicit failures into verified by passing time or a matching fingerprint",()=>{
  const fp=confirmedLinkFingerprint([link]);
  for(const current of ["NEEDS_RECONCILIATION","NOT_SYNCED","ERROR"]){
   expect(brokerSyncDisplayStatus(current,new Date("2026-10-16T06:00:00Z"),60,fp,fp,new Date("2026-10-16T06:05:00Z"))).toBe(current);
  }
 });
 it("does not count brokerage account holdings or API credentials in its fingerprint",()=>{
  const fingerprint=confirmedLinkFingerprint([link]);
  expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(fingerprint).not.toContain("t-1");
 });
});

describe("no linked trades",()=>{
  it("stays 'no linked trades' until a trade is linked, then needs a new check",()=>{
    const empty=confirmedLinkFingerprint([]);
    expect(brokerSyncDisplayStatus("NO_LINKED_TRADES",new Date(),60,empty,empty)).toBe("NO_LINKED_TRADES");
    const linked=confirmedLinkFingerprint([{externalTradeId:"1",ledgerEventId:"e",side:"BUY",quantity:"2"}]);
    expect(brokerSyncDisplayStatus("NO_LINKED_TRADES",new Date(),60,empty,linked)).toBe("NEEDS_RECONCILIATION");
  });
});
