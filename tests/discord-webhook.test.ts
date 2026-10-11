import { describe, expect, it } from "vitest";
import { isDiscordWebhookUrl } from "../src/domain/discord-webhook";

describe("Discord webhook URL", () => {
  it("accepts real webhook shapes", () => {
    expect(isDiscordWebhookUrl("https://discord.com/api/webhooks/123456789012345678/abc_DEF-123")).toBe(true);
    expect(isDiscordWebhookUrl("https://discordapp.com/api/webhooks/1/x")).toBe(true);
  });
  it("rejects other hosts, lookalikes, credentials, ports, schemes and paths", () => {
    for (const bad of [
      "http://discord.com/api/webhooks/1/x",
      "https://discord.com.evil.example/api/webhooks/1/x",
      "https://evil.example/https://discord.com/api/webhooks/1/x",
      "https://discord.com@evil.example/api/webhooks/1/x",
      "https://user:pw@discord.com/api/webhooks/1/x",
      "https://discord.com:8443/api/webhooks/1/x",
      "https://discord.com/api/webhooks/1/x/../../../steal",
      "https://discord.com/api/webhooks/abc/x",
      "https://discord.com/other/1/x",
      "https://169.254.169.254/api/webhooks/1/x",
      "https://discord.com\\@evil.example/api/webhooks/1/x",
      "not a url", ""
    ]) expect(isDiscordWebhookUrl(bad), bad).toBe(false);
  });
});
