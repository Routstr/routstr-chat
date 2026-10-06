"use client";

import React from "react";
import { renderCompanyIcon } from "@/components/v2/picker/display";
import type { useUi } from "../ui";
import type { Catalog } from "./useCatalog";

export default function Gate({ cat, onClose, ui, fund }: { cat: Catalog; onClose: () => void; ui: ReturnType<typeof useUi>; fund: () => void }) {
  return (
    <div className="mp-gatewrap">
      <div className="mp-gate">
        <div className="gate-marks" aria-hidden="true">
          {["anthropic", "openai", "google", "deepseek", "alibaba", "meta", "xai"].map((c, i) => (
            <span key={c} style={{ "--i": i } as React.CSSProperties}>{renderCompanyIcon(c, "co-ico")}</span>
          ))}
        </div>
        <p className="e-t">{cat.models.length ? `${cat.models.length} models, one wallet` : "Every model, one wallet"}</p>
        <p className="e-s">Models show up once you add a few sats or sign in.</p>
        <div className="e-row">
          <button className="soft sm" type="button" onClick={() => { onClose(); ui.setFace("auth"); }}>Sign in</button>
          <button className="prime sm" type="button" onClick={fund}>Add funds</button>
        </div>
      </div>
    </div>
  );
}
