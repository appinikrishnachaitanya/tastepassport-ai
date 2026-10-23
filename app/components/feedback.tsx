"use client";
import { sectionLabel } from "../../src/passport/labels";
import { useEffect, useRef, useState } from "react";
import { reasons } from "../../src/agent/types";
import type { Reason } from "../../src/agent/types";
import type { Card } from "../../src/passport/model";
import { Icon } from "./passport";
export default function FeedbackDialog({
  card,
  onClose,
  onSubmit,
}: {
  card: Card;
  onClose: () => void;
  onSubmit: (reason: Reason, detail: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<Reason>();
  const [detail, setDetail] = useState("");
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="match-dialog"
      aria-labelledby="feedback-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <span className="micro-label">REFINE YOUR VIBE</span>
        <button
          className="icon-button"
          aria-label="Close feedback"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <h2 id="feedback-title">What felt wrong?</h2>
      <p>
        <strong>{card.name}</strong> · I’ll update the {sectionLabel(card.section)} section
        while keeping your other discoveries.
      </p>
      <fieldset className="feedback-reasons">
        <legend className="sr-only">
          Reason for rejecting this recommendation
        </legend>
        {reasons.map((r) => (
          <label key={r}>
            <input
              type="radio"
              name="feedback-reason"
              checked={reason === r}
              onChange={() => setReason(r)}
            />
            {r}
          </label>
        ))}
      </fieldset>
      {reason === "Other" && (
        <>
          <label htmlFor="feedback-detail">
            What atmosphere are you looking for?
          </label>
          <textarea
            id="feedback-detail"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            maxLength={160}
          />
        </>
      )}
      <button
        className="primary-button"
        disabled={!reason || (reason === "Other" && !detail.trim())}
        onClick={() => reason && onSubmit(reason, detail)}
      >
        Update my {sectionLabel(card.section)} passport <Icon name="arrow" />
      </button>
    </dialog>
  );
}
