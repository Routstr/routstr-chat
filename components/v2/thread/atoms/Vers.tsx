"use client";

import { Icon } from "../../icons";
import { Roll } from "./Roll";

export function Vers({ at, of, go }: { at: number; of: number; go: (d: -1 | 1) => void }) {
  return (
    <div className="rd-vers" role="group" aria-label={`Version ${at} of ${of}`}>
      <button type="button" className="rd-tool" onClick={() => !(at <= 1) && go(-1)} aria-disabled={at <= 1} aria-label="Previous version" data-tip="Previous version">
        <Icon name="left" />
      </button>
      <span className="rd-vers-n" aria-hidden="true">
        <Roll value={at} />
        <span className="rd-of">
          / <Roll value={of} />
        </span>
      </span>
      <button type="button" className="rd-tool" onClick={() => !(at >= of) && go(1)} aria-disabled={at >= of} aria-label="Next version" data-tip="Next version">
        <Icon name="right" />
      </button>
    </div>
  );
}
