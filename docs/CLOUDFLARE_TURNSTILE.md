# Cloudflare Turnstile: Wealtharr public authentication protection

## Coverage and security model

When `TURNSTILE_ENABLED=true`, Wealtharr requires a fresh Cloudflare Turnstile
token **before** registration (`POST /api/register`), password-reset email requests
(`POST /api/password-reset/request`) and Auth.js **password** sign-in (the
credentials provider's `authorize` callback). The security check happens on
the server at Cloudflare's Siteverify endpoint. It cannot be bypassed by hiding,
removing or forging the browser widget.

The verifier rejects missing/oversized tokens, unsuccessful responses, token
replays and expiry (enforced by Cloudflare), unexpected origin hostname,
mismatched `action`, malformed responses, timeout and provider outages.
Rate limits remain in place. A failed verification must not create accounts,
send reset links or authenticate sessions.

Google/Apple OAuth flows continue to use their provider's authentication and
are **not** Turnstile-gated. Password reset **confirmation** is protected by
the one-time reset token, rather than consuming another challenge.

## Production configuration

1. In the Cloudflare Dashboard, create a Turnstile widget restricted to the
   *actual public hostname* configured by `NEXT_PUBLIC_APP_URL`. Use distinct
   widgets for staging and production. Choose managed mode.
2. On the **app server only**, configure:
   - `TURNSTILE_ENABLED=true`
   - `TURNSTILE_SITE_KEY=<public widget site key>`
   - `TURNSTILE_SECRET_KEY=<private Siteverify secret>`
   - `NEXT_PUBLIC_APP_URL=https://<same public hostname>`
3. Restart/redeploy the application. The app's Docker Compose `env_file`
   injects these values into the app service. Do not put them in the scheduler,
   browser bundle, logs or repository. The site key is rendered by the server
   into the page; **only** the site key is public.
4. Confirm from real browsers that registration, password sign-in and reset
   requests each complete the widget and that a replayed/invalid challenge
   is rejected. Test with a real production-domain hostname and separately
   with test keys on staging.
5. Run `npm run launch:preflight`. Commercial launch is blocked while
   Turnstile is disabled, keys are absent, or official dummy keys are configured.
   This is a necessary configuration check, **not** a substitute for a live
   challenge plus Siteverify smoke test.

If keys are absent but `TURNSTILE_ENABLED=true`, the challenge cannot be
completed and these sensitive actions **fail closed**. Enabling is opt-in to
avoid breaking existing staging installs before credentials are supplied.

The client widget uses explicit rendering (React SPA-safe) and refreshes after
every submission, because Cloudflare tokens are single-use and expire after
five minutes. No provider response, token or secret is logged.

The configured CSP explicitly allows Turnstile's iframe origin. Any future
strict `script-src` should include `https://challenges.cloudflare.com`
and preserve Next.js's own nonce policy.

## Official documentation

- https://developers.cloudflare.com/turnstile/get-started/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- https://developers.cloudflare.com/turnstile/troubleshooting/testing/

## Scope boundaries

Turnstile is one layer of bot mitigation, not user identity verification,
DDoS prevention, rate limiting, a WAF, a substitute for email verification
or MFA, or a claim that the site is safe to sell financial subscriptions.
It does not enable paid subscriptions or change strategy release gates.
