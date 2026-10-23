"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function ConfirmDelete({ title, description, busy, onCancel, onConfirm }: {
  title: string; description: string; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); opener?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="account-dialog confirm-delete-dialog" aria-labelledby="delete-title"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <span className="micro-label">CONFIRM DELETE</span>
    <h2 id="delete-title">{title}</h2>
    <p>{description}</p>
    <div className="profile-save-actions">
      <button type="button" className="quiet-button" autoFocus disabled={busy} onClick={onCancel}>Keep it</button>
      <button type="button" className="primary-button" disabled={busy} onClick={onConfirm}>{busy ? "Deleting…" : "Delete"}</button>
    </div>
  </dialog>, document.body);
}
