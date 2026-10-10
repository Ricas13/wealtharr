import "server-only";

export type EmailMessage = { to: string; subject: string; text: string };

export interface EmailProvider {
  send(message: EmailMessage): Promise<boolean>;
}

class MockEmailProvider implements EmailProvider {
  async send() { return true; }
}

class HttpEmailProvider implements EmailProvider {
  async send(message: EmailMessage) {
    const endpoint = process.env.EMAIL_HTTP_ENDPOINT;
    const token = process.env.EMAIL_HTTP_TOKEN;
    if (!endpoint || !token) return false;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, ...message }),
      cache:"no-store",
      redirect:"error",
      signal:AbortSignal.timeout(10_000)
    });
    return response.ok;
  }
}

export function getEmailProvider(): EmailProvider {
  if (process.env.NODE_ENV !== "production" && process.env.EMAIL_PROVIDER === "mock") return new MockEmailProvider();
  return new HttpEmailProvider();
}
