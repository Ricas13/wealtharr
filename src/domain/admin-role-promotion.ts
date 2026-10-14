import {z} from "zod";

/** An administrator promotion is privilege escalation. It always demands a
 * fresh MFA-backed sign-in and an independently verified/MFA-enrolled target. */
export const adminPromotionInput=z.object({
 email:z.email().max(254).transform(value=>value.trim().toLowerCase()),
 confirmation:z.literal("PROMOTE TO ADMIN")
}).strict();

export function recentAdminAuth(authTime:number,now:number,maxAgeMs=10*60_000):boolean{
 return Number.isSafeInteger(authTime)&&authTime>0&&authTime<=now&&now-authTime<=maxAgeMs;
}
export function promotionTargetEligible(input:{
 actorId:string;targetId:string;role:string;verified:boolean;mfaEnabled:boolean;deleted:boolean;
}):boolean{
 return input.targetId!==input.actorId&&input.role==="USER"&&input.verified&&input.mfaEnabled&&!input.deleted;
}
