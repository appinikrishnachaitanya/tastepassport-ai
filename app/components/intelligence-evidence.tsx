"use client";
import { useState } from "react";
import type { Card } from "../../src/passport/model";
import type { TasteResult } from "../../src/qloo/normalizer";
import { screenTasteConnection } from "../../src/qloo/explanation";
import { isPlaceSection } from "../../src/passport/model";
import { formatReturnedRating } from "../../src/passport/rating-display";
import { priceLabel } from "../../src/passport/pricing";
export function ResultMetrics({ card }: { card: Card }) {
  const m = card.intelligence;
  return (
    <div
      className="result-metrics"
      aria-label="Returned recommendation details"
    >
      {m?.quality?.businessRating !== undefined ? (
        <span
          aria-label={`Rated ${formatReturnedRating(m.quality.businessRating)} out of 5`}
        >
          ★ {formatReturnedRating(m.quality.businessRating)} / 5
        </span>
      ) : m?.externalProof?.tripadvisorRating !== undefined ? (
        <span aria-label={`Tripadvisor rating ${formatReturnedRating(m.externalProof?.tripadvisorRating)} out of 5`}>★ {formatReturnedRating(m.externalProof?.tripadvisorRating)} / 5 <small>Tripadvisor</small></span>
      ) : isPlaceSection(card.section) ? <span className="metric-unavailable">Rating unavailable</span> : null}
      {isPlaceSection(card.section) && priceLabel(m?.commercial?.priceLevel) && <span aria-label={`Listed price category: ${priceLabel(m?.commercial?.priceLevel)}`}>{priceLabel(m?.commercial?.priceLevel)}</span>}

    </div>
  );
}
export function WhyEvidence({
  card,
  session,
}: {
  card: Card;
  session?: { sessionId: string; revision: number };
}) {
  const [details, setDetails] = useState<TasteResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [explanation, setExplanation] = useState<string[]>([]);
  const m = card.intelligence,
    inputs = card.evidence?.inputs ?? [];
  async function more() {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/agent/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...session,
          action: "details",
          entityId: card.id,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error(b.error);
      setDetails(b.details);
    } catch {
      setError("More details are unavailable. Your suggestion is still here.");
    } finally {
      setLoading(false);
    }
  }
  async function explain() {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/agent/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...session,
          action: "explain",
          entityId: card.id,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw Error();
      setExplanation(b.sentences);
    } catch {
      setError(
        "The returned evidence above is still available. Please try the explanation again later.",
      );
    } finally {
      setLoading(false);
    }
  }
  const connected =
    m?.taste?.contributingSignals
      .filter(signal => signal.contribution > 0)
      .flatMap((signal) => {
        const input = inputs.find(
          (i) => i.id.toLowerCase() === signal.id.toLowerCase(),
        );
        return input ? [input.name] : [];
      })
      .slice(0, 3) ?? [];
  return (
    <div className="why-evidence">
      {card.evidence?.strategyNote?.startsWith("Broader local") && (
        <p>Broader local suggestion. Your venue requirements were kept.</p>
      )}
      <details>
        <summary>Interests considered</summary>
        <p>
          {inputs
            .filter((i) => i.role !== "tag-filter")
            .map((i) => i.name)
            .join(", ") || "Category and location requirements"}
        </p>
        {!screenTasteConnection(card) && <p>Search inputs are shown here; they do not by themselves establish an individual relationship.</p>}
      </details>
      {screenTasteConnection(card) ? <p>{screenTasteConnection(card)}</p> : !!connected.length && (
        <p>Connected to {connected.join(", ")} in your interests.</p>
      )}
      <dl className="evidence-metrics">
        {m?.quality?.businessRating !== undefined && (
          <>
            <dt>Listed rating</dt>
            <dd>{formatReturnedRating(m.quality.businessRating)} / 5</dd>
          </>
        )}
        {m?.externalProof?.tripadvisorRating !== undefined && (
          <>
            <dt>Tripadvisor</dt>
            <dd>
              {formatReturnedRating(m.externalProof?.tripadvisorRating)} / 5
              {m.externalProof?.tripadvisorReviewCount !== undefined
                ? ` · ${m.externalProof?.tripadvisorReviewCount} reviews`
                : ""}
            </dd>
          </>
        )}
      </dl>
      {!!card.evidence?.diagnostics?.dropped?.length && (
        <p className="helper">
          Some requested preferences are unavailable for this kind of
          suggestion. Your other preferences were kept.
        </p>
      )}
      {!!card.evidence?.diagnostics?.unverified?.length && <p className="helper">Some preferences cannot be independently checked from this listing. Verify important requirements with the venue.</p>}
      {session && (
        <div className="why-actions">
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={() => void more()}
          >
            {loading ? "Finding more details…" : "More details"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={() => void explain()}
          >
            Explain my match
          </button>
        </div>
      )}
      {!!explanation.length && (
        <ul>
          {explanation.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      )}
      {error && <p role="status">{error}</p>}
      {details?.description && <p>{details.description}</p>}
    </div>
  );
}
