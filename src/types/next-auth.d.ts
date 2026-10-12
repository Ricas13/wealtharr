import "next-auth";

declare module "next-auth" {
  interface User { role?: string; sessionVersion?: number; mfa?: boolean; authTime?: number }
  interface Session {
    user: {
      id: string;
      role: string;
      sessionVersion: number;
      /** True when the sign-in that opened this session verified a second factor. */
      mfa: boolean;
      /** Epoch milliseconds of that sign-in; 0 for sessions issued before this was recorded. */
      authTime: number;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }
}
