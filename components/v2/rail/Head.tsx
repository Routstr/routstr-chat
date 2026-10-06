"use client";

import { Icon, Mark } from "../icons";
import type { useUi } from "../ui";

export function Head({
  ui,
  folded,
  mac,
  phone,
  none,
  newCurrent,
  K,
  setFold,
  fresh,
}: {
  ui: ReturnType<typeof useUi>;
  folded: boolean;
  mac: boolean;
  phone: boolean;
  none: boolean;
  newCurrent: boolean;
  K: (k: string, shift?: boolean) => string;
  setFold: (on: boolean) => void;
  fresh: () => void;
}) {
  return (
    <>
      <header className="sb-head">
        <div className="sb-brand">
          <span className="sb-mark" aria-hidden="true">
            <Mark size={20} />
          </span>
          <span className="sb-word">routstr</span>
        </div>
        <button
          type="button"
          className="ghost sb-fold"
          data-tipk="fold"
          aria-label={folded ? "Show sidebar" : "Collapse sidebar"}
          aria-expanded={!folded}
          aria-keyshortcuts={mac ? "Meta+B" : "Control+B"}
          onClick={() => setFold(!folded)}
        >
          <Icon name="rail" />
        </button>
        <button type="button" className="ghost sb-close" aria-label="Close chats" onClick={() => ui.setDrawer(false)}>
          <Icon name="close" />
        </button>
      </header>
      <div className="sb-acts">
        <button
          type="button"
          className="sb-act sb-new"
          data-tipk="new"
          aria-current={newCurrent ? "page" : undefined}
          aria-keyshortcuts={mac ? "Meta+Shift+O" : "Control+Shift+O"}
          onClick={fresh}
        >
          {newCurrent && <span className="sb-glide" aria-hidden="true" />}
          <Icon name="plus" size={16} />
          <span className="sb-lbl">New chat</span>
          <kbd aria-hidden="true">{K("O", true)}</kbd>
        </button>
        <button
          type="button"
          className="sb-act sb-find"
          data-tipk="find"
          aria-disabled={none || undefined}
          aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
          onClick={() => {
            if (none) return;
            // one layer at a time: the drawer steps away as the search sheet rises
            ui.setDrawer(false);
            ui.setPalette(true);
          }}
        >
          <Icon name="search" size={16} />
          {/* a phone's field reads as the sheet it opens will */}
          <span className="sb-lbl">{phone ? "Find a chat or an action" : "Search chats"}</span>
          <kbd aria-hidden="true">{K("K")}</kbd>
        </button>
      </div>
    </>
  );
}
