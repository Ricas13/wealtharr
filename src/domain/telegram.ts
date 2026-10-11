import {createHash,timingSafeEqual} from "node:crypto";
export const TELEGRAM_ORIGIN="https://api.telegram.org";
export function validTelegramBotToken(value:unknown):value is string{
  return typeof value==="string"&&/^\d{5,15}:[A-Za-z0-9_-]{20,150}$/.test(value);
}
export function validTelegramWebhookSecret(value:unknown):value is string{
  return typeof value==="string"&&/^[A-Za-z0-9_-]{32,128}$/.test(value);
}
export function telegramStartToken(update:unknown):{token:string;chatId:string}|null{
  if(!update||typeof update!=="object")return null;
  const obj=update as {message?:{text?:unknown;chat?:{id?:unknown;type?:unknown};from?:{id?:unknown}}};
  const msg=obj.message;
  if(!msg||msg.chat?.type!=="private"||!Number.isSafeInteger(msg.chat.id)||msg.chat.id!==msg.from?.id)return null;
  if(typeof msg.text!=="string")return null;
  const match=/^\/start(?:@[A-Za-z0-9_]+)?\s+([a-f0-9]{48})$/.exec(msg.text.trim());
  return match?{token:match[1],chatId:String(msg.chat.id)}:null;
}
export function secureTokenMatch(actual:unknown,configured:unknown):boolean{
  if(!validTelegramWebhookSecret(configured)||typeof actual!=="string")return false;
  return timingSafeEqual(createHash("sha256").update(actual).digest(),
    createHash("sha256").update(configured).digest());
}
export function hashTelegramLinkToken(raw:string){return createHash("sha256").update(raw).digest("hex");}
