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
    return {...current,
      ...(target!=null?{reviewTargetValue:target}:{}),
      ...(contributions!=null?{reviewContributionsSnapshot:contributions}:{}),
      forceReview:true};
  }
  if(proposed.actionType==="HOLD"){
    const closed={...proposed.nextState};
    delete closed.reviewTargetValue;
    delete closed.reviewContributionsSnapshot;
    return {...closed,lastReviewAt:confirmedAt.toISOString(),forceReview:false};
  }
  return proposed.nextState;
}
