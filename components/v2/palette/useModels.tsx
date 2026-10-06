import { useCallback, useMemo } from "react";
import type { Model } from "@/types/models";
import { getModelCompanyId } from "@/components/v2/picker/modelCompanies";
import { renderCompanyIcon } from "@/components/v2/picker/display";
import { Icon } from "../icons";
import { shortModelName } from "../format";
import { estimateSats, promptTokens } from "../price";

export function useModels(models: Model[]) {
  const byId = useMemo(() => new Map((models as Model[]).map((m) => [m.id, m])), [models]);
  const glyph = useCallback(
    (id?: string, size: "row" | "inline" = "row") => {
      if (!id) return <Icon name="chat" size={size === "row" ? 16 : 13} />;
      const m = byId.get(id) ?? ({ id, name: id } as Model);
      return renderCompanyIcon(getModelCompanyId(m), "co-ico");
    },
    [byId]
  );
  const perReply = useCallback((m?: Model | null) => (m ? estimateSats(m, promptTokens("", "")) : 0), []);
  const modelWords = useMemo(
    () =>
      (models as Model[])
        .map((m) => `${shortModelName(m.name, m.id)} ${getModelCompanyId(m)}`)
        .join(" ")
        .toLowerCase(),
    [models]
  );
  return { byId, glyph, perReply, modelWords };
}
