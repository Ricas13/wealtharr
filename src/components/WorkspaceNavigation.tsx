"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

function isCurrent(pathname:string,href:string,includeChildren:boolean) {
  return pathname===href || (includeChildren && pathname.startsWith(href+"/"));
}

export function WorkspaceNavLink({href,children}:{href:string;children:ReactNode}) {
  const pathname=usePathname();
  const current=isCurrent(pathname,href,href!=="/app");
  return <Link href={href} className={"nav-link"+(current?" current":"")} aria-current={current?"page":undefined}>{children}</Link>;
}

export function WorkspaceTabLink({href,children}:{href:string;children:ReactNode}) {
  const pathname=usePathname();
  const current=isCurrent(pathname,href,false);
  return <Link href={href} className={"strategy-tab-link"+(current?" current":"")} aria-current={current?"page":undefined}>{children}</Link>;
}
