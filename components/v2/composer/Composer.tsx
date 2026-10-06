"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useAccountChat, useAsking, useHeldCredit } from "@/features/chat/view";
import { useCatalogService } from "@/features/catalog/view";
import { useThread } from "@/features/history/view";
import { useSession } from "@/features/session/view";
import { getModelCompanyId } from "@/components/v2/picker/modelCompanies";
import { renderCompanyIcon } from "@/components/v2/picker/display";
import { normalizeModality } from "@/components/v2/picker/modality";
import type { MessageAttachment } from "@/types/chat";
import type { Model } from "@/types/models";
import { isModelAvailable } from "@/utils/modelUtils";
import { Icon } from "../icons";
import { useChipRef, useDraft, useUi } from "../ui";
import { useActions } from "../useActions";
import { useChatModel } from "../useChatModel";
import { useMoney } from "../useMoney";
import { sats, satUnit, shortModelName, textOf } from "../format";
import { useAttachments } from "./useAttachments";
import { estimateSats, promptTokens } from "../price";
import { settle, takeFlight } from "./landing";
import { tokenMs } from "../motion";
import Back from "./back/Back";
import { useFirstSend } from "./back/useFirstSend";

/** The model chip, so the picker can hang from it. */

const isTouch = () => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
const isPhone = () => typeof window !== "undefined" && window.innerWidth <= 760;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A rough price for this message: what the cheapest route charges for the
 *  words so far, the text of any attached files and a reply of ordinary
 *  length. It holds still while you type (settling) and settles 600ms after
 *  the last key; a model or a file change re-rolls it at once. */
function useEstimate(model: Model | null, draft: string, history: string, files: string) {
  const catalog = useCatalogService();
  const [value, setValue] = useState<number | null>(null);
  const [settling, setSettling] = useState(false);
  const lastDraft = useRef<string | null>(null);
  // no model, no price
  if (!model && (value !== null || settling)) {
    setValue(null);
    setSettling(false);
  }
  useEffect(() => {
    if (!model) return;
    const typed = lastDraft.current !== null && lastDraft.current !== draft && !!draft;
    lastDraft.current = draft;
    if (typed) setSettling(true);
    const t = window.setTimeout(() => {
      const ranked = catalog?.routes(model.id) ?? [];
      const priced = (ranked[0]?.model as unknown as Model | undefined) ?? model;
      const v = estimateSats(priced, promptTokens(`${history} ${files}`, draft));
      setValue(v > 0 ? v : null);
      setSettling(false);
    }, typed ? 600 : 0);
    return () => window.clearTimeout(t);
  }, [model, draft, history, files, catalog]);
  return { value, settling };
}

/* The island's voice: the price, or one short line about a file, always in
   this one place. A new value rolls in from below as the old one leaves. */
function Voice({ id, children, settling, tone }: { id: string; children: React.ReactNode; settling: boolean; tone?: "say" }) {
  const [items, setItems] = useState([{ id, node: children, tone, out: false }]);
  const last = useRef(id);
  // the id carries the value, so a new id is a new value; the same id keeps its node
  useEffect(() => {
    if (id === last.current) return;
    last.current = id;
    setItems((xs) => [...xs.filter((x) => !x.out).map((x) => ({ ...x, out: true })), { id, node: children, tone, out: false }]);
    const t = window.setTimeout(() => setItems((xs) => xs.filter((x) => !x.out)), tokenMs("--d-fast") + 20);
    return () => window.clearTimeout(t);
  }, [id]);
  return (
    <span className="voice" data-settling={settling ? "" : undefined}>
      {items.map((x) => (
        <span key={x.id} className="v" data-out={x.out ? "" : undefined} data-tone={x.tone}>
          {x.node}
        </span>
      ))}
    </span>
  );
}

const SHORT: Record<string, string> = {
  "SVG is not supported": "No SVG",
  "Only images and PDFs": "Images or PDFs",
  "Storage full, may not be kept": "Storage full",
};

const size = (b?: number) => (!b ? "" : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/* A file waiting to go: a picture or a page, with its backup to your relays
   drawn as an arc along its own edge. */
function Tile({ a, reading, onRemove, onTip }: { a: MessageAttachment; reading: boolean; onRemove: () => void; onTip: (el: HTMLElement | null) => void }) {
  const sync = a.blossomUploadStatus === "success" ? "done" : a.blossomUploadStatus ?? undefined;
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (sync !== "done") return;
    const t = window.setTimeout(() => setSettled(true), 900);
    return () => window.clearTimeout(t);
  }, [sync]);
  const image = a.type === "image";
  return (
    <div
      className="file"
      data-kind={image ? "image" : "pdf"}
      data-sync={sync}
      data-settled={settled ? "" : undefined}
      onPointerEnter={(e) => sync === "failed" && e.pointerType !== "touch" && onTip(e.currentTarget)}
      onPointerLeave={() => onTip(null)}
      onFocus={(e) => sync === "failed" && onTip(e.currentTarget)}
      onBlur={() => onTip(null)}
    >
      {image ? (
        <img className="thumb" src={a.dataUrl} alt={a.name} />
      ) : (
        <>
          <span className="doc" aria-hidden="true">PDF</span>
          <span className="meta">
            <span className="fname">{a.name}</span>
            <span className="fsub" data-reading={reading ? "" : undefined}>
              {reading ? "Reading…" : size(a.size)}
            </span>
          </span>
        </>
      )}
      {sync && (
        <svg className="edge" aria-hidden="true">
          <rect className="run" pathLength={100} />
          <rect className="full" pathLength={100} />
        </svg>
      )}
      <button className="fx" type="button" onClick={onRemove} aria-label={`Remove ${a.name}`}>
        <Icon name="close" size={11} />
      </button>
    </div>
  );
}

export default function Composer({ centred }: { centred: boolean }) {
  const { activeConversationId, isWalletLoading } = useChat();
  const { text: inputMessage, setText: setInputMessage, attachments: uploadedAttachments, setAttachments: setUploadedAttachments } = useDraft();
  const { model: selectedModel, chosen, loading: isLoadingModels } = useChatModel();
  const catalog = useCatalogService();
  const chat = useAccountChat()?.chat;
  const isLoading = useAsking(activeConversationId);
  const stopGeneration = useCallback(() => {
    if (activeConversationId) chat?.stop(activeConversationId);
  }, [chat, activeConversationId]);
  const slots = useThread(activeConversationId);
  const isAuthenticated = useSession().pubkey !== null;
  const ui = useUi();
  const money = useMoney();
  // what a provider holds for you pays the next reply first
  const held = useHeldCredit();
  const lowBalanceWarningForModel = !!selectedModel && !isModelAvailable(selectedModel, money.total + held);
  const { send } = useActions();
  const field = useRef<HTMLTextAreaElement>(null);
  const island = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const chip = useChipRef();
  const tray = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState(0);
  const [cut, setCut] = useState<"" | "top" | "bottom" | "both">("");
  const [trayOver, setTrayOver] = useState<"" | "start" | "end" | "both">("");
  const [leaving, setLeaving] = useState(false);
  const [failTip, setFailTip] = useState<number | null>(null);
  const tipFor = useCallback((el: HTMLElement | null) => {
    const isl = island.current;
    if (!el || !isl) return setFailTip(null);
    const r = el.getBoundingClientRect();
    const i = isl.getBoundingClientRect();
    setFailTip(Math.max(0, Math.min(r.left - i.left, i.width - 240)));
  }, []);
  const lifting = useRef(false);
  const [problem, setProblem] = useState<{ text: string; at: number } | null>(null);
  const liveSay = useRef<HTMLSpanElement>(null);

  const say = useCallback((text: string) => setProblem({ text, at: Date.now() }), []);
  useEffect(() => {
    if (!problem) return;
    const t = window.setTimeout(() => setProblem(null), 2500);
    return () => window.clearTimeout(t);
  }, [problem]);
  const { addFiles, remove, reading } = useAttachments(setUploadedAttachments, say);

  const history = useMemo(() => (slots ?? []).map((s) => textOf(s.displayed.content)).join(" "), [slots]);
  const fileText = useMemo(() => uploadedAttachments.map((a) => a.textContent ?? "").join(" "), [uploadedAttachments]);
  const estimate = useEstimate(selectedModel, inputMessage, history, fileText);

  const face = ui.face;
  // the back of the card stays drawn while it turns away
  const [back, setBack] = useState<"pay" | "auth" | "who" | null>(null);
  if (face !== "write" && back !== face) setBack(face);
  useEffect(() => {
    if (face !== "write") return;
    const t = window.setTimeout(() => setBack(null), 600);
    return () => window.clearTimeout(t);
  }, [face]);

  // the card's height glides as it turns (fr rows in an auto-height grid
  // would snap): the rows run in pixels for the turn, then CSS has them back
  const under = useRef<HTMLDivElement>(null);
  const showing = useRef<"front" | "back">("front");
  const turnT = useRef(0);
  useLayoutEffect(() => {
    const u = under.current;
    const want = face === "write" ? "front" : "back";
    const [front, backEl] = Array.from(u?.children ?? []) as HTMLElement[];
    // turning over waits for the back to be drawn
    if (!u || !front || !backEl || want === showing.current || (want === "back" && !backEl.firstElementChild)) return;
    showing.current = want;
    if (reduced()) return;
    const a = `${front.scrollHeight}px`;
    // the back sizes itself in its first frames; the rows still hold during the delay
    // the back's own card, as laid out: the height the rows settle on
    const backH = () => (backEl.firstElementChild as HTMLElement | null)?.getBoundingClientRect().height ?? 0;
    const from = want === "back" ? `${a} 0px` : `0px ${backH()}px`;
    let raf = 0;
    let tries = 0;
    const run = () => {
      if (!backH() && tries++ < 8) {
        raf = requestAnimationFrame(run);
        return;
      }
      const b = `${backH()}px`;
      u.style.transition = "none";
      u.style.gridTemplateRows = want === "back" ? from : `0px ${b}`;
      void u.offsetHeight;
      u.style.transition = "";
      u.style.gridTemplateRows = want === "back" ? `0px ${b}` : `${a} 0px`;
      // handed back once the turn has run; the back unmounting later must not cut this short
      window.clearTimeout(turnT.current);
      turnT.current = window.setTimeout(() => (u.style.gridTemplateRows = ""), tokenMs("--d-slow") + tokenMs("--d-mid") + 60);
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [face, back]);
  useEffect(() => () => window.clearTimeout(turnT.current), []);
  const hasContent = inputMessage.trim().length > 0 || uploadedAttachments.length > 0;
  const busy = isLoadingModels || (isWalletLoading && isAuthenticated);
  const takesImages = (selectedModel?.architecture?.input_modalities ?? []).some(
    (m) => normalizeModality(m) === "image"
  );
  // "loading" lasts until the app has made its own pick, not just until models arrive
  const modelState = selectedModel ? "ready" : isAuthenticated && busy ? "loading" : "none";

  // grow with the words, instantly; never animate the box a caret lives in.
  // Past the cap it scrolls, and only the edge that hides words dissolves.
  const measureCut = useCallback(() => {
    const f = field.current;
    if (!f) return;
    if (f.scrollHeight - f.clientHeight <= 1) return setCut("");
    const top = f.scrollTop > 2;
    const bottom = f.scrollTop + f.clientHeight < f.scrollHeight - 2;
    setCut(top && bottom ? "both" : top ? "top" : bottom ? "bottom" : "");
  }, []);
  useLayoutEffect(() => {
    const f = field.current;
    if (!f) return;
    f.style.height = "0px";
    f.style.height = `${Math.min(f.scrollHeight, isPhone() ? 210 : 238)}px`;
    measureCut();
  }, [inputMessage, centred, face, measureCut]);

  // the back of the card is split under the words: where the band ends
  useLayoutEffect(() => {
    const isl = island.current;
    const b = band.current;
    if (!isl || !b) return;
    const put = () => isl.style.setProperty("--pa-band", `${Math.round(b.getBoundingClientRect().bottom - isl.getBoundingClientRect().top + 10)}px`);
    put();
    window.addEventListener("resize", put);
    return () => window.removeEventListener("resize", put);
  }, [face, inputMessage, uploadedAttachments.length]);

  // a send from the dock: the old top edge settles once the words are gone
  const settleFrom = useRef(0);
  useLayoutEffect(() => {
    if (!settleFrom.current || !island.current) return;
    settle(island.current, settleFrom.current, tokenMs("--d-move"));
    settleFrom.current = 0;
  }, [inputMessage, uploadedAttachments]);

  // focus the field whenever it is the thing to type into
  useEffect(() => {
    if (face === "write" && !isTouch()) field.current?.focus({ preventScroll: true });
  }, [face, centred, activeConversationId]);

  // the tray says which side has more files to see
  const measureTray = useCallback(() => {
    const t = tray.current;
    if (!t) return;
    const start = t.scrollLeft > 2;
    const end = t.scrollWidth - t.scrollLeft - t.clientWidth > 2;
    setTrayOver(start && end ? "both" : start ? "start" : end ? "end" : "");
  }, []);
  useLayoutEffect(measureTray, [uploadedAttachments, measureTray]);

  const needsMoney = !money.node && (!isAuthenticated || lowBalanceWarningForModel);

  const first = useFirstSend(needsMoney);

  // leave for the thread: from the centre the whole island travels (see
  // landing.ts); from the dock the words lift away and the card settles
  const launch = useCallback(() => {
    const isl = island.current;
    if (centred) {
      if (isl) takeFlight(isl);
      void send();
      return;
    }
    if (reduced() || !isl) {
      void send();
      return;
    }
    if (lifting.current) return;
    lifting.current = true;
    setLeaving(true);
    window.setTimeout(() => {
      settleFrom.current = isl.offsetHeight;
      lifting.current = false;
      setLeaving(false);
      void send();
    }, tokenMs("--d-fast"));
  }, [centred, send]);

  const go = useCallback(() => {
    if (isLoading || !hasContent) return;
    // nobody to write as yet: that comes before models and money
    if (first.need === "who") return first.hold();
    if (busy) {
      // the disc says no, and the chip that is loading answers
      setRefused(Date.now());
      if (liveSay.current) {
        liveSay.current.textContent = "";
        const why = isWalletLoading && isAuthenticated ? "Your wallet is still loading" : "Models are still loading";
        window.setTimeout(() => liveSay.current && (liveSay.current.textContent = why), 30);
      }
      return;
    }
    if (!selectedModel) return ui.setPicker(true);
    if (first.need || needsMoney) return first.hold();
    if (ui.sendWhenFunded) ui.setSendWhenFunded(false);
    launch();
  }, [isLoading, hasContent, first, busy, isWalletLoading, isAuthenticated, selectedModel, needsMoney, launch, ui]);

  useEffect(() => {
    if (!refused) return;
    const t = window.setTimeout(() => setRefused(0), 760);
    return () => window.clearTimeout(t);
  }, [refused]);

  // money arrived for a held message: turn back, then send it by itself
  useEffect(() => {
    if (!ui.sendWhenFunded || !isAuthenticated || money.total <= 0 || busy) return;
    if (!selectedModel) {
      // funded, but nothing chosen to answer: pick one and it sends
      if (ui.face !== "write") {
        ui.setFace("write");
        ui.setPicker(true);
      }
      return;
    }
    if (needsMoney) return;
    // the seal shows, then the card turns back and the held words send
    const t = window.setTimeout(() => {
      ui.setFace("write");
      ui.setSendWhenFunded(false);
      window.setTimeout(launch, 420);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [ui, needsMoney, isAuthenticated, money.total, selectedModel, busy, launch]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
      e.preventDefault();
      go();
    }
  };
  // the whole window takes a drop; the island is the target
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => e.dataTransfer?.types?.includes("Files");
    const enter = (e: DragEvent) => {
      if (!has(e)) return;
      depth++;
      setDrag(true);
    };
    const leave = (e: DragEvent) => {
      if (!has(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) {
        setDrag(false);
        setOver(false);
      }
    };
    const dragOver = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setOver(!!island.current?.contains(e.target as Node));
    };
    const drop = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth = 0;
      setDrag(false);
      setOver(false);
      if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files, "drop");
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", dragOver);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", dragOver);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.type.startsWith("image/"))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files, "paste");
  };

  // pressing the card anywhere that is not a control puts the caret in the words
  const onCardDown = (e: React.PointerEvent) => {
    if (face !== "write") return;
    const t = e.target as HTMLElement;
    if (t.closest("button, input, textarea, a, .file")) return;
    e.preventDefault();
    field.current?.focus();
  };

  const name = selectedModel
    ? shortModelName(selectedModel.name, selectedModel.id)
    : modelState === "loading"
      ? "Finding models"
      : "Choose a model";
  const company = selectedModel ? getModelCompanyId(selectedModel) : "other";
  // where it goes, one hover away: the pinned provider, or how many can answer
  const routeTip = useMemo(() => {
    if (modelState === "loading") return "Asking providers what they serve";
    if (!selectedModel) return "Choose a model to send";
    if (chosen?.provider && chosen.id === selectedModel.id) {
      try {
        return `Pinned to ${new URL(chosen.provider).host}`;
      } catch {
        return "";
      }
    }
    const n = catalog?.routes(selectedModel.id).length ?? 0;
    return n > 1 ? `Cheapest of ${n} providers` : "";
  }, [selectedModel, modelState, chosen, catalog]);

  // the chip's mark and name arrive when the model changes, not on first draw.
  // The spans are keyed by model; the flag stays on for that model, so a later
  // render never takes it off and cuts the arrival short
  const [chipModel, setChipModel] = useState<{ model?: string; arrived?: string }>({ model: selectedModel?.id });
  if (chipModel.model !== selectedModel?.id) setChipModel({ model: selectedModel?.id, arrived: selectedModel?.id });
  const arrive = !!selectedModel && chipModel.arrived === selectedModel.id;

  const placeholder = centred ? "Ask anything" : "Reply";
  const live = hasContent && face === "write" && !isLoading && ((modelState === "ready" && !busy) || (!isAuthenticated && !money.node));
  const priceShown = !money.node && !isLoading && estimate.value !== null;
  const voiceId = problem ? `say-${problem.at}` : priceShown ? `p-${sats(estimate.value!)}` : "none";
  const voice = problem ? (
    <>
      <span className="v-long">{problem.text}</span>
      <span className="v-short" aria-hidden="true">{SHORT[problem.text] ?? problem.text}</span>
    </>
  ) : priceShown ? (
    <>
      <b>~{sats(estimate.value!)}</b> {satUnit(estimate.value!)}
    </>
  ) : null;

  const files = uploadedAttachments.length > 0;

  return (
    <div
      ref={island}
      className="island"
      data-place={centred ? "centre" : "dock"}
      data-face={face}
      data-model={modelState}
      data-files={files ? "" : undefined}
      data-drag={drag ? "" : undefined}
      data-over={over ? "" : undefined}
      data-picking={ui.picker ? "" : undefined}
    >
      <span className="tip tip-fail" data-on={failTip !== null ? "" : undefined} style={{ left: failTip ?? 0 }} aria-hidden="true">
        Could not save an online copy
      </span>
      <div className="sh sh-rest" aria-hidden="true" />
      <div className="sh sh-lift" aria-hidden="true" />
      <div className="sh sh-deep" aria-hidden="true" />
      <div className="turn" aria-hidden="true">
        <div className="side front" />
        <div className="side back" />
      </div>
      <div className="ring" aria-hidden="true" />

      <div className="island-in" onPointerDown={onCardDown}>
        <div className="tray" data-over={trayOver || undefined}>
          <div className="tray-clip">
            <div className="tray-in" ref={tray} onScroll={measureTray}>
              {uploadedAttachments.map((a) => (
                <Tile
                  key={a.id}
                  a={a}
                  reading={reading.has(a.id)}
                  onTip={tipFor}
                  onRemove={() => {
                    remove(a.id);
                    field.current?.focus({ preventScroll: true });
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="fw" data-cut={cut || undefined} ref={band}>
          <textarea
            ref={field}
            className="field"
            rows={1}
            value={inputMessage}
            placeholder={placeholder}
            aria-label="Message"
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={onKey}
            onPaste={onPaste}
            onScroll={measureCut}
            readOnly={face !== "write"}
            data-leaving={leaving ? "" : undefined}
            spellCheck
          />
          <button
            className="ghost pa-x"
            type="button"
            tabIndex={face === "write" ? -1 : 0}
            aria-hidden={face === "write" || undefined}
            aria-label="Back to your message"
            onClick={() => {
              ui.setSendWhenFunded(false);
              ui.setFace("write");
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="under" ref={under}>
          <div className="crow" inert={face !== "write"}>
            <span className="tipped">
              <button
                className="attach"
                type="button"
                onClick={() => fileInput.current?.click()}
                aria-label={takesImages ? "Attach images or PDFs" : "Attach a PDF"}
              >
                <Icon name="clip" />
              </button>
              <span className="tip">{takesImages || !selectedModel ? "Attach images or PDFs" : "Attach a PDF, this model reads text only"}</span>
            </span>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept="image/*,application/pdf"
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files, "pick");
                e.target.value = "";
              }}
            />
            {/* a press opens or closes the picker; its tip waits until the pointer leaves and comes back */}
            <span
              className="chip-wrap tipped"
              onPointerDown={(e) => e.currentTarget.setAttribute("data-quiet", "")}
              onPointerLeave={(e) => e.currentTarget.removeAttribute("data-quiet")}
            >
              <button
                ref={chip}
                className="model"
                type="button"
                aria-haspopup={modelState === "loading" ? undefined : "dialog"}
                aria-expanded={modelState === "loading" ? undefined : ui.picker}
                aria-disabled={modelState === "loading" || undefined}
                aria-label={selectedModel ? `Model: ${name}. Change model` : name}
                data-ping={refused ? "" : undefined}
                onClick={() => modelState !== "loading" && ui.setPicker(!ui.picker)}
              >
                <span className="model-ico" key={`i-${selectedModel?.id}`} data-in={arrive ? "" : undefined}>
                  {modelState === "ready" ? (
                    renderCompanyIcon(company, "co-ico")
                  ) : modelState === "loading" ? (
                    <span className="dots" aria-hidden="true"><i /><i /><i /></span>
                  ) : (
                    <span className="ring-ico" aria-hidden="true" />
                  )}
                </span>
                <span className="model-n" key={`n-${selectedModel?.id}`} data-in={arrive ? "" : undefined}>{name}</span>
                <Icon name="down" className="chev" />
              </button>
              {routeTip && <span className="tip tip-chip">{routeTip}</span>}
            </span>
            <span className="voice-wrap tipped" data-price={priceShown && !problem ? "" : undefined}>
              <Voice id={voiceId} settling={estimate.settling && !problem} tone={problem ? "say" : undefined}>
                {voice}
              </Voice>
              <span className="tip tip-end">About what this reply costs</span>
              <span className="sr" aria-live="polite" ref={liveSay}>{problem?.text ?? ""}</span>
            </span>
            <span className="tipped">
              <button
                className="go"
                type="button"
                data-mode={isLoading ? "stop" : "send"}
                data-live={live ? "" : undefined}
                data-no={refused ? "" : undefined}
                onClick={isLoading ? stopGeneration : go}
                aria-label={isLoading ? "Stop" : "Send"}
                aria-disabled={!isLoading && !live ? true : undefined}
              >
                <span className="go-g">
                  <Icon name="send" className="g-send" />
                  <Icon name="stop" className="g-stop" />
                </span>
              </button>
              <span className="tip tip-end">
                {isLoading ? "Stop" : <>Send <kbd>Enter</kbd></>}
              </span>
            </span>
          </div>

          <div className="backside" inert={face === "write"}>
            {back && <Back face={back} island={island} />}
          </div>
        </div>
      </div>

      <div className="drop" aria-hidden="true">
        <div className="drop-in">
          <Icon name="image" size={22} className="drop-ico" />
          <span className="drop-t">Drop to attach</span>
          <span className="drop-s">Images and PDFs, up to 10 MB each</span>
        </div>
      </div>
    </div>
  );
}
