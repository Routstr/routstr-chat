import type React from "react";
import type { Conversation } from "@/types/chat";
import type { Model } from "@/types/models";
import type { ROOMS, RoomId } from "../room/RoomProvider";
import type { Sec } from "./sections";

export type Room = (typeof ROOMS)[number];
export type ActId = "new" | "model" | "wallet" | "room" | "sync" | "rail" | "settings";
export type Found = { idx: number; at: number; len: number; body: string };
type Kind = "chat" | "action" | "room" | "roomjump" | "setting" | "fallback";
export interface Item {
  kind: Kind;
  id: string;
  verb: string;
  ic: React.ReactNode;
  label: React.ReactNode;
  sub?: React.ReactNode;
  hint?: React.ReactNode;
  chat?: Conversation;
  found?: Found;
  count?: number;
  room?: Room;
  sec?: Sec;
  act?: ActId;
}
export interface Group {
  title: string;
  items: Item[];
  best?: number;
  ghost?: number;
  note?: string;
  fallback?: boolean;
}
export type Sync = "idle" | "running" | "done" | "fail" | "nokey" | "norelay" | "slow";
export type SyncOutcome = "ok" | "failed" | "offline";
export type Exit = { keepRoom?: boolean; composer?: boolean; handoff?: boolean };
export type Sel = { id?: string; at: number; q: string; page: string; list: Item[] };

export interface Ctx {
  page: "root" | "rooms";
  sync: Sync;
  came: string[];
  origRoom: RoomId | null;
  roomNow: RoomId;
  roomResolved: RoomId;
  first: boolean;
  onEmpty: boolean;
  loaded: boolean;
  conversations: Conversation[];
  current: (c: Conversation) => boolean;
  glyph: (id?: string) => React.ReactNode;
  perReply: (m?: Model | null) => number;
  byId: Map<string, Model>;
  selectedModel: Model | null;
  total: number;
  railOff: boolean;
}
