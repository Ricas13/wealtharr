import {describe,expect,it} from "vitest";
import {hashTelegramLinkToken,secureTokenMatch,telegramStartToken,validTelegramBotToken,validTelegramWebhookSecret} from "@/domain/telegram";
const token="a".repeat(48);
const correct={message:{text:"/start "+token,chat:{id:1234567,type:"private"},from:{id:1234567}}};
describe("Telegram account-link safety",()=>{
  it("requires a private chat owned by the sender and an exact one-time token",()=>{
    expect(telegramStartToken(correct)).toEqual({token,chatId:"1234567"});
    expect(telegramStartToken({...correct,message:{...correct.message,chat:{id:1234567,type:"group"}}})).toBeNull();
    expect(telegramStartToken({...correct,message:{...correct.message,from:{id:987}}})).toBeNull();
    expect(telegramStartToken({...correct,message:{...correct.message,text:"/start b"}})).toBeNull();
    expect(telegramStartToken({})).toBeNull();
  });
  it("rejects missing or invalid webhook secret before accepting signed updates",()=>{
    const secret="A".repeat(40);
    expect(validTelegramWebhookSecret(secret)).toBe(true);
    expect(secureTokenMatch(secret,secret)).toBe(true);
    expect(secureTokenMatch("B".repeat(40),secret)).toBe(false);
    expect(secureTokenMatch(secret,"bad")).toBe(false);
    expect(secureTokenMatch(undefined,secret)).toBe(false);
    expect(hashTelegramLinkToken(token)).not.toContain(token);
  });
  it("checks BotFather token formatting",()=>{
    expect(validTelegramBotToken("123456789:"+"A".repeat(35))).toBe(true);
    expect(validTelegramBotToken("bad")).toBe(false);
  });
});
