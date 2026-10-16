import Link from "next/link";

/**
 * Consistent disclosure for public pages, tools and the authenticated workspace.
 * Neutral wording does not by itself establish a regulatory exemption.
 */
export function ResearchDisclaimer(){
 return <aside className="research-disclaimer" aria-label="Research and financial risk information">
  <p><strong>For research and educational purposes only.</strong> Wealtharr calculates outputs from investment rules
   and information chosen by you. It does not assess suitability or provide personalised financial advice,
   and it never places trades. You decide whether and when to act.</p>
  <p>Prices and calculations may be delayed, incomplete or incorrect. Investments can lose value; leveraged
   products can cause substantial losses. <Link href="/research-disclaimer">Read the full research disclaimer</Link>.</p>
 </aside>;
}
