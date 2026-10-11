/**
 * Customers paste their own Discord webhook and the server later POSTs to it, so it must be exactly a
 * Discord webhook: https, a Discord host, no credentials, no custom port, and a /api/webhooks/ path.
 * Parsing (rather than a string-prefix test) closes host tricks such as userinfo or lookalike domains.
 */
export function isDiscordWebhookUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "https:"
    && (url.hostname === "discord.com" || url.hostname === "discordapp.com")
    && url.port === "" && url.username === "" && url.password === ""
    && /^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
}
