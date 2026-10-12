/**
 * True when a URL host name is not a public internet host: loopback, private (RFC 1918), shared
 * address space, link-local (including the cloud metadata address 169.254.169.254), unspecified,
 * multicast/reserved, single-label or internal-looking names, and any IPv6 literal outside the
 * global unicast block 2000::/3. Used to stop an admin-supplied endpoint from pointing a stored
 * bearer token at the host's own network. It looks at the written host only: it does not resolve
 * DNS, so a public name that resolves to a private address is not caught here.
 *
 * `hostname` is what `new URL(...).hostname` returns (IPv6 in brackets; numeric IPv4 forms such as
 * 2130706433 or 0x7f.1 are already normalised to dotted decimal by the URL parser).
 */
export function isNonPublicHost(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  host = host.replace(/\.+$/, "");
  if (!host) return true;

  if (host.includes(":")) {
    // IPv6 literal: only 2000::/3 is global unicast.
    const first = Number.parseInt(host.split(":")[0] || "0", 16);
    if (!Number.isFinite(first)) return true;
    return !(first >= 0x2000 && first <= 0x3fff);
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && Number(v4[3]) === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }

  if (!host.includes(".")) return true; // "localhost", "db", "metadata" ...
  if (/\.(localhost|local|internal|lan|home|home\.arpa|corp|intranet|private)$/.test(host)) return true;
  return false;
}
