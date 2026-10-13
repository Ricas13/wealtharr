# Cloudflare Turnstile — managed in Wealtharr Admin

All Turnstile configuration happens **inside Wealtharr**, without editing environment
files, container definitions, source code or restarting the application.

## Set up

1. In your Cloudflare dashboard, create a Turnstile **Managed** widget for the
   exact hostname configured as Wealtharr's **Admin → Settings → General →
   Public web address**. If you run staging and production, create a separate
   Turnstile widget for each hostname. Copy the *site key* and *secret key*.
2. Sign in to Wealtharr as an administrator and open **Admin → Settings →
   Cloudflare Turnstile**.
3. Paste the **site key** and **secret key**, leave **Enable Cloudflare Turnstile**
   set to **Off**, and select **Save changes**. The secret is encrypted in
   Wealtharr's existing operator-settings database and hidden on subsequent visits.
4. Under **Test your saved configuration**, complete the actual challenge and
   select **Test connection**. Wealtharr sends only the browser-issued token
   to its own admin endpoint, which verifies it using the saved private secret
   at Cloudflare's Siteverify service. Cloudflare must confirm the expected
   hostname and the special `admin-test` action.
5. Once the test succeeds, turn **Enable Cloudflare Turnstile** **On** and
   **Save changes**. There is no redeploy or restart. Visit registration,
   password login and password-reset pages to verify the user experience.
6. If you need to rotate credentials, disable protection, save, then replace
   both the site key and secret key, test, and re-enable. Admin settings prevent
   enabling with incomplete or mismatched stored-key changes.

## Protected routes

With the setting enabled, the following require a fresh widget token validated
on the server: registration, password-based sign-in and request-a-reset-link.
OAuth providers are not challenged by Wealtharr; a reset confirmation still
requires its one-time email recovery token.

The same old rate limits remain. Cloudflare rejects expired/replayed tokens;
Wealtharr additionally validates the returned hostname and action. Outages or
invalid responses fail closed. Siteverify secrets and tokens are never
stored in frontend settings or application logs.

**Disable protection immediately from Admin → Settings** if your Cloudflare
widget becomes unavailable or you cannot solve it from the real site. An
administrator with an existing session can still access Admin to switch it off.

## Launch gate

Admin → Launch readiness checks the *saved* configuration through Wealtharr's
settings loader and blocks live paid checkout until Turnstile is enabled and
its credentials appear configured. This is not equivalent to a live verified
challenge; perform the on-screen test before enabling live sales.

The CLI `npm run launch:preflight` may not load database-stored operator settings
in a standalone terminal process. For up-to-date effective settings and live
readiness, use **Admin → Launch readiness**.

## Notes

Only the initial core server bootstrap (database connection, authentication
session secret and the encryption key that protects settings) remains a host-level
responsibility in Wealtharr. **No Cloudflare Turnstile settings need a .env file.**

- https://developers.cloudflare.com/turnstile/get-started/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
