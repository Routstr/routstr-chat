"use client";

import { Suspense } from "react";
import App from "@/components/v2/App";

// the app draws its own boot (the mark, then first light) once it is running
export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  );
}
