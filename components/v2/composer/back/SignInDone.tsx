"use client";

import React from "react";
import { Seal } from "./bits";

export default function SignInDone({ done }: { done: "in" | "new" | null }) {
  return (
    <div className="pa-view" data-view="done">
      <div className="pa-done" role="status">
        <Seal />
        <h2 className="pa-t">{done === "new" ? "A key of your own" : "You are in"}</h2>
        <p className="pa-sub">
          {done === "new" ? "It lives on this device. Back it up in Settings, Account, whenever you like." : "Your chats will follow this key, encrypted."}
        </p>
      </div>
    </div>
  );
}
