/**
 * Explicit invitation-only beta enrolment. Returning accounts remain eligible
 * even if the operator later removes their address from the invite list.
 * Never infer an invitation from the email's domain.
 */
type BetaEnvironment=Pick<NodeJS.ProcessEnv,"WEALTHARR_PRIVATE_BETA_INVITE_ONLY"|"WEALTHARR_BETA_INVITE_EMAILS">;

export function newAccountIsInvited(email:string,env:BetaEnvironment):boolean{
  if(env.WEALTHARR_PRIVATE_BETA_INVITE_ONLY!=="true")return true;
  const target=email.trim().toLowerCase();
  if(!target)return false;
  const entries=(env.WEALTHARR_BETA_INVITE_EMAILS??"").split(/[\s,;]+/);
  return entries.some(candidate=>candidate.toLowerCase()===target);
}
