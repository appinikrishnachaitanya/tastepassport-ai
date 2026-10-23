"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./passport";
export default function ConciergeDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    opener.current = document.activeElement as HTMLElement;
    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
      opener.current?.focus();
    };
  }, [open]);
  return (
    <dialog
      id="taste-concierge"
      ref={dialog}
      className="concierge-drawer"
      aria-labelledby="concierge-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) {
          const rect = dialog.current.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="concierge-heading">
        <span className="agent-avatar">
          <Icon name="star" />
        </span>
        <div>
          <h2 id="concierge-title">Ask TastePassport</h2>
          <p>Make these suggestions feel more like you.</p>
        </div>
        <div className="concierge-heading-actions">
          <button
            className="icon-button assistant-close"
            aria-label="Close Taste Concierge"
            title="Close"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>
      {children}
    </dialog>
  );
}
