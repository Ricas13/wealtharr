import {describe,it,expect} from "vitest";
import {postActionReviewState} from "@/domain/strategy/review-completion";

const now=new Date("2026-10-09T17:00:00Z");
const original={lastReviewAt:"2026-07-01T20:00:00.000Z",cashReserve:"80"};
const proposal={nextState:{lastCalculatedAt:"2026-10-09T17:00:00.000Z",completed:true}};
describe("review lifecycle follows verified fills, not target projection",()=>{
 it("keeps the review due after a buy, even when the engine projected completion",()=>{
  expect(postActionReviewState({...proposal,actionType:"BUY"},original,now))
    .toEqual({...original,forceReview:true});
 });
 it("does not advance when a sale was recorded but the corresponding purchase is still pending",()=>{
  expect(postActionReviewState({...proposal,actionType:"SELL"},original,now).lastReviewAt)
    .toBe(original.lastReviewAt);
 });
 it("locks a value-target review without applying its quarterly growth rate more than once",()=>{
  const result=postActionReviewState({
    actionType:"BUY",nextState:{targetValue:"6540",lastCalculatedAt:now.toISOString()}
  },{targetValue:"6000",lastReviewAt:original.lastReviewAt},now);
  expect(result.targetValue).toBe("6000");
  expect(result.reviewTargetValue).toBe("6540");
  expect(result.forceReview).toBe(true);
  const second=postActionReviewState({
    actionType:"SELL",nextState:{targetValue:"6540"}
  },result,now);
  expect(second.reviewTargetValue).toBe("6540");
  const closed=postActionReviewState({
    actionType:"HOLD",nextState:{...second,targetValue:"6540"}
  },second,now);
  expect(closed.targetValue).toBe("6540");
  expect(closed).not.toHaveProperty("reviewTargetValue");
  expect(closed).not.toHaveProperty("reviewContributionsSnapshot");
  expect(closed.lastReviewAt).toBe(now.toISOString());
 });
 it("persists each contribution snapshot with the updated review target through repeated buy fills",()=>{
  const first=postActionReviewState({actionType:"BUY",
    nextState:{targetValue:"7040",reviewContributionsSnapshot:"1000"}},{targetValue:"6000"},now);
  expect(first.reviewTargetValue).toBe("7040");
  expect(first.reviewContributionsSnapshot).toBe("1000");
  const second=postActionReviewState({actionType:"BUY",
    nextState:{targetValue:"7240",reviewContributionsSnapshot:"1400"}},first,now);
  expect(second.reviewTargetValue).toBe("7240");
  expect(second.reviewContributionsSnapshot).toBe("1400");
 });
 it("keeps a multi-leg rebalance open until all actual broker quantities are reconciled",()=>{
  expect(postActionReviewState({...proposal,actionType:"REBALANCE"},original,now).forceReview).toBe(true);
 });
 it("closes a confirmed within-tolerance HOLD review exactly once",()=>{
  expect(postActionReviewState({...proposal,actionType:"HOLD"},original,now))
    .toMatchObject({...proposal.nextState,lastReviewAt:now.toISOString(),forceReview:false});
 });
 it("never changes review history on a missing-data or no-action calculation",()=>{
  expect(postActionReviewState({...proposal,actionType:"DATA_REQUIRED"},original,now)).toBe(proposal.nextState);
  expect(postActionReviewState({...proposal,actionType:"NO_ACTION"},original,now)).toBe(proposal.nextState);
 });
});
