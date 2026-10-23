"use client";
import { sectionLabel } from "../../src/passport/labels";
import { useEffect, useRef, useState } from "react";
import type { AgentInput, TastePassportSession } from "../../src/agent/types";
import type { Card, Section } from "../../src/passport/model";
import { familiarities } from "../../src/passport/evidence";
import { activeCategories } from "../../src/passport/active-categories";
import { sectionOrder } from "../../src/workspace/state";
export function FamiliarityControl({
  session,
  disabled,
  onChange,
}: {
  session: TastePassportSession;
  disabled: boolean;
  onChange: (input: AgentInput) => void;
}) {
  const [section, setSection] = useState<Section>(()=>sectionOrder.find(s=>session.cards.some(c=>c.section===s)) ?? "Eat");
  const available=activeCategories(session,session.cards);
  const effectiveSection=available.includes(section)?section:available[0] ?? "Eat";
  const applied = session.categoryModes[effectiveSection] ?? session.discoveryMode;
  return (
    <section className="familiarity-panel" aria-labelledby="familiarity-title">
      <div className="panel-heading">
        <div>
          <span className="micro-label">YOUR KIND OF DISCOVERY</span>
          <h2 id="familiarity-title">How should your {sectionLabel(effectiveSection).toLowerCase()} suggestions feel?</h2>
        </div>
        {available.length>1 && <div className="mode-category-tabs" role="group" aria-label="Choose a Passport category">{available.map(category=><button type="button" key={category} disabled={disabled} aria-pressed={effectiveSection===category} onClick={()=>setSection(category)}>{sectionLabel(category)}</button>)}</div>}

      </div>
      <div className="familiarity-axis">
        <span>Feels Like Home</span>
        <span>Help Me Explore</span>
      </div>
      <div
        className="familiarity-options"
        role="group"
        aria-label="Familiarity mode"
      >
        {familiarities.map((mode) => (
          <button
            key={mode}
            aria-pressed={applied === mode}
            disabled={disabled}
            onClick={() => onChange({ familiarity: { mode, section:effectiveSection } })}
          >
            <span className="mode-orbit" aria-hidden="true" />
            <strong>
              {mode === "familiar"
                ? "Feels like home"
                : mode === "balanced"
                  ? "Balanced"
                  : "Help me explore"}
            </strong>
            <small>
              {mode === "familiar"
                ? "Start with what you love"
                : mode === "balanced"
                  ? "A little familiar, a little new"
                  : "Find your next favorite"}
            </small>
          </button>
        ))}
      </div>
      <p className="mode-caption">
        {applied === "familiar"
          ? "Prioritize closer matches to your tastes."
          : applied === "balanced"
            ? "Mix closer matches with broader cultural discoveries."
            : "Explore further while keeping a connection to your tastes."}{" "}
        Changes refresh {sectionLabel(effectiveSection)} in Discover. My Vibe keeps the specific discoveries you saved; results can overlap when coverage is limited.
      </p>
    </section>
  );
}
export interface ModelBaseline {
  text: string;
  model: string;
  generatedAt: string;
  source: "model-only";
  request?: string;
}
export function ComparisonPanel({
  baseline,
  cards,
}: {
  baseline?: ModelBaseline;
  cards: Card[];
}) {
  if (!baseline) return null;
  const grounded = cards.filter(
    (c) => c.evidence?.source === "Qloo" && c.evidence?.result.id === c.id,
  );
  return (
    <section className="comparison-panel" aria-labelledby="comparison-title">
      <span className="micro-label">TWO WAYS TO FIND SOMETHING NEW</span>
      <h2 id="comparison-title">General ideas or suggestions based on your tastes?</h2>
      {baseline.request && (
        <blockquote className="comparison-request">
          <span>THE SAME USER REQUEST</span>
          {baseline.request}
        </blockquote>
      )}
      <div className="comparison-columns">
        <article>
          <span className="comparison-label">
            General AI suggestions
          </span>
          <p className="baseline-disclaimer">
            Generated without our recommendation service. These ideas are unverified and never
            become a Passport card.
          </p>
          <p className="baseline-text">{baseline.text}</p>
          <small>
            {baseline.model} ·{" "}
            {new Date(baseline.generatedAt).toLocaleDateString()}
          </small>
        </article>
        <article>
          <span className="comparison-label">Your personalized discoveries</span>
          <h3>
            {grounded.length}{" "}
            {grounded.length === 1 ? "discovery" : "discoveries"}
          </h3>
          <p>
            Based on the interests you confirmed. Open a suggestion’s details
            to see how it was found.
          </p>
          <ul>
            {grounded.slice(0, 3).map((c) => (
              <li key={c.id}>
                {c.name}
                <small>
                  {c.section} ·{" "}
                  {c.evidence!.locality === "physical-city"
                    ? c.evidence!.destination
                    : "City audience context"}
                </small>
              </li>
            ))}
          </ul>
        </article>
      </div>
      <table>
        <caption>How the sources differ</caption>
        <thead>
          <tr>
            <th>Dimension</th>
            <th>Model-only</th>
            <th>Personalized suggestions</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["Specificity", "Generated prose", "Returned entity IDs and types"],
            [
              "Grounded signals",
              "Taste names in the prompt",
              "Confirmed entity/tag IDs in the query",
            ],
            [
              "Cross-domain",
              "Model associations, unverified",
              "Recorded cultural inputs across domains",
            ],
            [
              "Location",
              "Requested city, unverified",
              "Place filters and returned locality; artist audience context",
            ],
            [
              "Evidence",
              "No verified recommendation sources",
              "Query receipts and returned metadata",
            ],
          ].map((row) => (
            <tr key={row[0]}>
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={i}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
export function ModelComparison({
  session,
  available,
}: {
  session: TastePassportSession;
  available: boolean;
}) {
  const [baseline, setBaseline] = useState<ModelBaseline>();
  const [comparedCards, setComparedCards] = useState<Card[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setBaseline(undefined);
    setComparedCards([]);
    setError("");
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [session.id, session.comparison?.revision]);
  if (!available || !session.comparison) return null;
  async function compare() {
    const started = generation.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/agent/comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      if (!response.ok) throw Error();
      const data = await response.json();
      if (
        data.baseline?.source !== "model-only" ||
        typeof data.baseline.request !== "string" ||
        data.baseline.request !== data.comparison?.request ||
        !Array.isArray(data.comparison.cards)
      )
        throw Error();
      if (started !== generation.current) return;
      setComparedCards(data.comparison.cards);
      setBaseline(data.baseline);
    } catch {
      if (started !== generation.current) return;
      setError(
        "The comparison is unavailable right now. Your Passport is still here.",
      );
    } finally {
      if (started === generation.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="compare-control">
        <button
          className="quiet-button"
          disabled={busy}
          onClick={() => void compare()}
        >
          {busy
            ? "Generating a live model-only baseline…"
            : "Compare recommendation approaches"}
        </button>
        {error && <p role="status">{error}</p>}
      </div>
      <ComparisonPanel baseline={baseline} cards={comparedCards} />
    </>
  );
}
