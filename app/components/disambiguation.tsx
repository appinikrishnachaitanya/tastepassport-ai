"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { Candidate } from "../../src/passport/model";
import { typeLabel } from "../../src/workspace/state";
import { rankCandidates } from "../../src/passport/matching";
import { Icon } from "./passport";
export function CandidateChoices({
  query,
  candidates,
  selected,
  onSelect,
  disabled = false,
}: {
  query: string;
  candidates: Candidate[];
  selected?: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const group = useId();
  return (
    <fieldset className="candidate-options">
      <legend className="sr-only">Matches for {query}</legend>
      {rankCandidates(query,candidates).map((c) => (
        <label
          key={c.id}
          className={`candidate-option ${selected === c.id ? "chosen" : ""}`}
        >
          <input
            disabled={disabled}
            type="radio"
            name={group}
            value={c.id}
            checked={selected === c.id}
            onChange={() => onSelect(c.id)}
          />
          <span>
            <strong>{c.name}</strong>
            <small>{typeLabel(c)}</small>
            {c.detail && <p>{c.detail}</p>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
export default function Disambiguation({
  item,
  current,
  onConfirm,
  onClose,
}: {
  item: { query: string; candidates: Candidate[] };
  current?: string;
  onConfirm: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(current);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="match-dialog"
      aria-labelledby="match-title"
      aria-describedby="match-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <span className="micro-label">A LITTLE CLARITY</span>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close match selection"
        >
          <Icon name="close" />
        </button>
      </div>
      <h2 id="match-title">Which one feels like you?</h2>
      <p id="match-description">
        Matches for <strong>{item.query}</strong>. Pick the interest you
        meant.
      </p>
      <CandidateChoices
        query={item.query}
        candidates={item.candidates}
        selected={selected}
        onSelect={setSelected}
      />
      <button
        className="primary-button"
        disabled={!selected}
        onClick={() => selected && onConfirm(selected)}
      >
        Confirm this taste <Icon name="check" />
      </button>
      <p className="dialog-footnote">
        Can’t find it? Close this window and edit your taste.
      </p>
    </dialog>
  );
}
