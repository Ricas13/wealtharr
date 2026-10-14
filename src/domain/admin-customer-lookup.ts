import {z} from "zod";

/** POST body: never place a customer's email query in a browser URL, referrer or server access log. */
export const customerLookupInput=z.object({
  emailQuery:z.string().trim().min(3).max(100).refine(value=>!/[\u0000-\u001f\u007f]/.test(value), "Invalid search text."),
  page:z.number().int().min(1).max(10000).default(1)
}).strict();

export const CUSTOMER_LOOKUP_PAGE_SIZE=25;

export function customerLookupWindow(total:number,requestedPage:number){
  const safeTotal=Math.max(0,Math.floor(total));
  const pages=Math.max(1,Math.ceil(safeTotal/CUSTOMER_LOOKUP_PAGE_SIZE));
  const page=Math.max(1,Math.min(pages,Math.floor(requestedPage)));
  return {page,pages,offset:(page-1)*CUSTOMER_LOOKUP_PAGE_SIZE,limit:CUSTOMER_LOOKUP_PAGE_SIZE};
}
