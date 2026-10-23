"use client";
import { useEffect, useState } from "react";
import { Icon } from "./passport";
export function ToastNotice() {
  const [notice, setNotice] = useState<{ message: string; kind: string; id: number }>();
  useEffect(() => {
    const handler = (event: Event) => {
      const { message, kind } = (event as CustomEvent).detail ?? {};
      if (typeof message === "string") setNotice({ message: message.slice(0, 500), kind, id: Date.now() });
    };
    window.addEventListener("tastepassport:notice", handler);
    return () => window.removeEventListener("tastepassport:notice", handler);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  return notice ? <div className={`toast-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-atomic="true">
    <Icon name={notice.kind === "error" ? "close" : "check"} size={18} />
    <span>{notice.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(undefined)}><Icon name="close" size={14} /></button>
  </div> : null;
}
export function JourneyLoading({ phase, detail }: { phase: string; detail: string }) {
  return <div className="compact-progress journey-loading" role="status" aria-live="polite" aria-atomic="true">
    <span className="journey-spinner" aria-hidden="true"><Icon name="star" size={22} /></span>
    <div><strong>{phase === "resolving" ? "Finding your flavor…" : phase === "refining" ? "A little more you…" : "Cooking up your Passport…"}</strong><p>{detail}</p></div>
  </div>;
}
