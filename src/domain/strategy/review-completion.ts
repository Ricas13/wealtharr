import type {ProposedAction} from "./types";

/**
 * A calculated trade is not a completed review. Closing a period based on estimated
 * quantities can skip a required leg after fees, partial fills or price changes.
 * The ledger mutation triggers another calculation, after which a HOLD confirmation
 * can advance the strategy's last review instant.
 */
export function postActionReviewState(
  proposed: Pick<ProposedAction,"actionType"|"nextState">,
  current:Record<string,unknown>,
  confirmedAt:Date
):Record<string,unknown>{
  if(["BUY","SELL","REBALANCE"].includes(proposed.actionType)){
    // VALUE_TARGET uses a stable target through each trade in a quarterly review.
    // Do not commit targetValue yet: otherwise the next calculation applies the
    // quarterly growth factor a second time before the review has actually ended.
    const target=proposed.nextState.targetValue;
    const contributions=proposed.nextState.reviewContributionsSnapshot;
    // In-review markers of the quarterly signal family (sigReview*) persist until the review closes.
    const sigReview=Object.fromEntries(Object.entries(proposed.nextState).filter(([k])=>k.startsWith("sigReview")));
    return {...current,
      ...sigReview,
      ...(target!=null?{reviewTargetValue:target}:{}),
      ...(contributions!=null?{reviewContributionsSnapshot:contributions}:{}),
      forceReview:true};
  }
  if(proposed.actionType==="HOLD"){
    const closed={...proposed.nextState};
    delete closed.reviewTargetValue;
    delete closed.reviewContributionsSnapshot;
    for(const key of Object.keys(closed))if(key.startsWith("sigReview"))delete closed[key];
    return {...closed,lastReviewAt:confirmedAt.toISOString(),forceReview:false};
  }
  return proposed.nextState;
}
