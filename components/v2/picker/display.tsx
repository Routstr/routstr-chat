import type { ReactNode } from "react";
import {
  COMPANY_ICON_COMPONENTS,
  getCompanyMeta,
} from "./modelCompanies";

export function renderCompanyIcon(
  companyId: string,
  className = "h-4 w-4"
): ReactNode {
  const Icon = COMPANY_ICON_COMPONENTS[companyId];
  if (!Icon) {
    return (
      <span className="text-[10px] font-bold leading-none" aria-hidden="true">
        {getCompanyMeta(companyId).shortLabel}
      </span>
    );
  }

  return <Icon size="1em" className={className} aria-hidden="true" />;
}
