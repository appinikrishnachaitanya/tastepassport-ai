"use client";
import { sectionLabel } from "../../src/passport/labels";
import { useState } from "react";
import { ResultMetrics, WhyEvidence } from "./intelligence-evidence";
import { evidenceFacts, recommendationSummary } from "../../src/qloo/explanation";
import { threeChoices } from "../../src/passport/shortlist";
import { bridgeRoutes, sparseSections } from "../../src/passport/evidence";
import type { Candidate, Card, Section } from "../../src/passport/model";
import {
  typeLabel,
  visibleSections,
} from "../../src/workspace/state";
import type { Passport } from "../../src/workspace/state";
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    Movies: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></>,
    Books: <><path d="M12 5v16M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z"/></>,
    Podcasts: <><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
    Shows: <><rect x="3" y="6" width="18" height="14" rx="2"/><path d="m8 2 4 4 4-4"/></>,
    Games: <><path d="M7 7h10c4 0 7 12 3 13-2 0-3-4-5-4H9c-2 0-3 4-5 4C0 19 3 7 7 7ZM6 10v5M4 12h4M16 11h.01M19 14h.01"/></>,
    People: <><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    Destinations: <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16M15 5v16"/></>,
    sliders: <><path d="M3 6h7M14 6h7M3 12h3M10 12h11M3 18h11M18 18h3"/><circle cx="12" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></>,
    star: (
      <>
        <path d="m12 2 2.3 6.5L21 11l-6.7 2.5L12 21l-2.3-7.5L3 11l6.7-2.5L12 2Z" />
        <path d="m20 2 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" />
      </>
    ),
    pin: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    arrow: (
      <>
        <path d="M4 12h16M14 6l6 6-6 6" />
      </>
    ),
    send: (
      <>
        <path d="m3 11 18-8-7 18-3-7-8-3Z" />
        <path d="m11 14 10-11" />
      </>
    ),
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></>,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    Eat: (
      <>
        <path d="M5 3v6a3 3 0 0 0 6 0V3M8 3v18M19 3v18M19 3c-4 0-4 10 0 10" />
      </>
    ),
    Coffee: (
      <>
        <path d="M3 8h13v7a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8ZM16 9h2a3 3 0 0 1 0 6h-2M6 3v2M11 3v2" />
      </>
    ),
    Music: (
      <>
        <path d="M9 17V5l11-2v12M9 8l11-2" />
        <ellipse cx="6" cy="18" rx="3" ry="2" />
        <ellipse cx="17" cy="16" rx="3" ry="2" />
      </>
    ),
    Culture: (
      <>
        <path d="m3 8 9-5 9 5H3ZM5 10v8M10 10v8M15 10v8M20 10v8M3 21h18" />
      </>
    ),
    Lifestyle: (
      <>
        <path d="M5 7h14l2 14H3L5 7ZM8 7V6a4 4 0 0 1 8 0v1" />
      </>
    ),
    heart: (
      <path d="M12 21S2 15 2 8a5 5 0 0 1 10-1A5 5 0 0 1 22 8c0 7-10 13-10 13Z" />
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.star}
    </svg>
  );
}
export function TasteDNA({
  signals,
  onRemove,
  disabled,
}: {
  signals: Candidate[];
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <section className="dna-panel" aria-labelledby="dna-title">
      <div className="panel-heading">
        <div>
          <span className="micro-label">YOUR CONFIRMED INTERESTS</span>
          <h2 id="dna-title">What you love.</h2>
        </div>
        <span className="count-pill">{signals.length} confirmed</span>
      </div>
      {signals.length ? (
        <div className="dna-cluster">
          {signals.map((s, i) => (
            <div className={`dna-chip tone-${i % 3}`} key={s.id}>
              <span className="signal-dot" />
              <div>
                <strong>{s.name}</strong>
                <small>{typeLabel(s)}</small>
              </div>
              <details className="signal-inspect">
                <summary aria-label={`Inspect ${s.name}`}>↗</summary>
                <div className="signal-receipt">
                  <p>
                    Matched as a{" "}
                    {s.id.startsWith("urn:tag:")
                      ? "tag workflow"
                      : "entity search"}
                  </p>
                  <code>{s.id}</code>
                  <small>{s.types.join(" · ")}</small>
                </div>
              </details>
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                disabled={disabled}
                aria-label={`Remove ${s.name}`}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="dna-empty">
          <span className="orbital" aria-hidden="true">
            <i />
            <i />
            <i />
            <b>✳</b>
          </span>
          <p>
            Your world, in a few cultural signals.
            <br />
            <span>Your confirmed interests will appear here.</span>
          </p>
        </div>
      )}
    </section>
  );
}
export function TranslationMap({
  signals,
  result,
}: {
  signals: Candidate[];
  result?: Passport;
}) {
  const cards = result?.cards ?? [];
  const routes = bridgeRoutes(cards, signals);
  const sections = visibleSections(cards);
  return (
    <section
      className="translation-panel cultural-bridge"
      aria-labelledby="translation-title"
    >
      <div className="panel-heading">
        <div>
          <span className="micro-label">YOUR CULTURAL BRIDGE</span>
          <h2 id="translation-title">Your world. Translated.</h2>
        </div>
        <span className="bridge-query-count">
          {new Set(routes.map((r) => r.id.split(":")[0])).size} auditable
          queries
        </span>
      </div>
      <div className="bridge-column-labels">
        <span>YOUR WORLD</span>
        <span>QLOO CULTURAL INTELLIGENCE</span>
        <span>YOUR NEW CITY</span>
      </div>
      {routes.length ? (
        <div className="bridge-routes">
          {routes.map((route) => (
            <div
              className={`bridge-route pool-${route.pool}`}
              key={route.id}
              data-query-receipt={route.id}
            >
              <div className="bridge-inputs">
                {route.inputs.map((input) => (
                  <span key={input.id}>
                    {input.name}
                    <small>{typeLabel(input)}</small>
                  </span>
                ))}
              </div>
              <div className="map-bridge" aria-hidden="true">
                <svg viewBox="0 0 160 100" preserveAspectRatio="none">
                  <path d="M0 20C45 20 35 50 80 50S115 20 160 20M0 80C45 80 35 50 80 50S115 80 160 80" />
                </svg>
                <span>
                  <Icon name="star" size={23} />
                  <b>Taste</b>
                </span>
              </div>
              <div className="bridge-output">
                <span className="map-target">
                  <Icon name={route.section} size={17} />
                  <strong>
                    {route.destination}
                    <small>
                      {sectionLabel(route.section)} · {route.count} returned{" "}
                      {route.count === 1 ? "discovery" : "discoveries"}
                    </small>
                  </strong>
                </span>
                <span className="bridge-pool-label">
                  {route.mode} ·{" "}
                  {route.pool === "adjacent"
                    ? "adjacent cultural pool"
                    : route.pool === "profile"
                      ? "grounded profile pool"
                      : "direct cultural pool"}
                </span>
                {route.locality === "audience-context" && (
                  <small>Audience context, not a local venue</small>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bridge-awaiting">
          <Icon name="globe" size={36} />
          <p>
            A bridge built from evidence.
            <span>
              Connections appear only after a search returns a grounded
              discovery.
            </span>
          </p>
          <div>
            {signals.map((signal) => (
              <span key={signal.id}>{signal.name}</span>
            ))}
          </div>
          {sections.length > 0 && (
            <small>
              Available categories: {sections.join(", ")}. Query evidence is
              needed before drawing connections.
            </small>
          )}
        </div>
      )}
      <p className="provenance-note">
        These are collective query-input → returned-category connections.
        Individual taste-to-place links are not provided. Inspect each card’s
        the returned evidence for each suggestion.
      </p>
    </section>
  );
}

export type Feedback = "like" | "dislike";
function EntityPhoto({url,name,section}:{url?:string;name:string;section:Section}) {
  const [failed,setFailed]=useState(false);
  return <div className={`discovery-photo${!url || failed ? " photo-placeholder" : ""}`}>
    {url && !failed ? <img src={url} alt={name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>
      : <><Icon name={section} size={44}/><span>{`${sectionLabel(section)} discovery`}</span></>}
  </div>;
}
export function DiscoveryCard({
  session,
  card,
  feedback,
  onFeedback,
  live = false,
  disabled = false,
}: {
  session?: { sessionId: string; revision: number };
  live?: boolean;
  disabled?: boolean;
  card: Card;
  feedback?: Feedback;
  onFeedback: (id: string, value: Feedback) => void;
}) {
  return (
    <article
      data-entity-id={card.id}
      className={`discovery-card card-${card.section.toLowerCase()} ${feedback === "dislike" ? "muted-card" : ""}`}
    >
      <EntityPhoto key={card.intelligence?.image ?? card.id} url={card.intelligence?.image} name={card.name} section={card.section}/>
      <div className="card-header">
        <span className="category-token">
          <Icon name={card.section} size={14} />
          {sectionLabel(card.section)}
        </span>
        {card.evidence && <span className="helper">{card.evidence.params?.["filter.goal"] === "hidden-gems" || card.evidence.params?.["goal"] === "hidden-gems" || card.evidence.mode === "explore" ? "Explore choice" : card.evidence.pool === "adjacent" ? "Broader discovery" : card.evidence.pool === "direct" ? "Familiar starting point" : "Your taste profile"}</span>}
      </div>
      <div className="discovery-title">
        <span className="card-cultural-mark" aria-hidden="true">
          <Icon name={card.section} size={24} />
        </span>
        <h4>{card.name}</h4>
      </div>
      {recommendationSummary(card) && <p className="card-query-inputs">{recommendationSummary(card)}</p>}
      {card.address && (
        <p className="card-address">
          <Icon name="pin" size={13} />
          {card.address}
        </p>
      )}
      {card.description && (
        <p className="card-description">{card.description}</p>
      )}
      {card.evidence?.strategyNote?.startsWith("Broader local") && (
        <p className="helper">Broader local suggestion</p>
      )}
      <ResultMetrics card={card} />
      <details className="why-section">
        <summary>
          Why this suggestion? <Icon name="plus" size={12} />
        </summary>
        {evidenceFacts(card).slice(0, 4).map((fact) => <p key={fact}>{fact}</p>)}
        <div className="why-signals">
          {(
            card.evidence?.inputs
              .filter((i) => !i.name.startsWith("urn:"))
              .map((i) => i.name) ?? []
          )
            .filter((name, i, all) => all.indexOf(name) === i)
            .map((name) => (
              <span key={name}>{name}</span>
            ))}
        </div>
        <WhyEvidence card={card} session={session} />
      </details>
      <div className="feedback-actions">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={feedback === "like"}
          className={feedback === "like" ? "liked" : ""}
          onClick={() => onFeedback(card.id, "like")}
        >
          <Icon name="heart" size={14} />
          My vibe
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={feedback === "dislike"}
          className={feedback === "dislike" ? "disliked" : ""}
          onClick={() => onFeedback(card.id, "dislike")}
        >
          <Icon name="close" size={14} />
          Not my vibe
        </button>
      </div>
      {feedback && (
        <small className="feedback-note">
          {live
            ? "Your preference is saved for this visit. We’ll look for a replacement when one is available."
            : "Preference saved for this session. Recommendations haven’t been replanned."}
        </small>
      )}
    </article>
  );
}
export function PassportSections({
  result,
  feedback,
  onFeedback,
  updates = {},
  updating = [],
  previewLimit = 3,
}: {
  previewLimit?: number;
  updates?: Partial<Record<Section, number>>;
  updating?: Section[];
  result: Passport;
  feedback: Record<string, Feedback>;
  onFeedback: (id: string, value: Feedback) => void;
}) {
  const [expanded, setExpanded] = useState<Partial<Record<Section, boolean>>>(
    {},
  );
  const sections = visibleSections(result.cards);
  const hasGaps = result.notices.some((n) =>
    /failed|unavailable|returned no|no discoveries|limited|Local places:|Music:/i.test(
      n,
    ),
  );
  return (
    <div className="passport-sections">
      {result.notices.length > 0 && (
        <aside className="partial-notice" role="status">
          <details>
            <summary>
              {hasGaps
                ? "Your passport is ready, with a few gaps."
                : "A few notes about your discoveries"}
            </summary>
            <p>
              Some categories have fewer suggestions available. You can adjust
              your interests or try again.
            </p>
            {result.notices.map((notice, index) => (
              <p key={index}>{notice}</p>
            ))}
          </details>
        </aside>
      )}
      {!sections.length && (
        <div className="empty-results">
          <Icon name="globe" size={30} />
          <h3>No suitable discoveries yet.</h3>
          <p>
            Try another confirmed taste or retry later. We won’t fill your
            passport with guesses.
          </p>
        </div>
      )}
      {sparseSections(result.cards, sections).length > 0 && (
        <p className="sparse-coverage" role="status">
          A smaller selection in{" "}
          {sparseSections(result.cards, sections).join(", ")}. Your valid
          discoveries are shown; try Balanced or Explore to widen the cultural
          bridge.
        </p>
      )}
      {sections.map((s) => (
        <section
          className="result-section"
          data-category={s.toLowerCase()}
          key={`${s}:${updates[s] ?? 0}`}
          aria-busy={updating.includes(s)}
          aria-labelledby={`section-${s}`}
        >
          <div className="result-heading">
            <h3 id={`section-${s}`} tabIndex={-1}>
              <Icon name={s} />
              {sectionLabel(s)}
              <span>{result.cards.filter((c) => c.section === s).length}</span>
            </h3>
            <p>
              {s === "Music"
                ? "A soundtrack for your next chapter · artist taste, not local concerts"
                : s === "Eat"
                  ? "A familiar table. A new city."
                  : s === "Coffee"
                    ? "Find your next daily ritual."
                    : s === "Culture"
                      ? "Culture to make this place yours."
                      : "Small discoveries. New routines."}
            </p>
          </div>
          {updating.includes(s) && (
            <p className="section-progress" role="status">
              Updating your {sectionLabel(s)} passport… Your current discoveries stay
              available.
            </p>
          )}
          {s === "Eat" && result.session?.queryPreferences?.Eat?.locationPoint && (
            <div className="active-area-banner" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "var(--surface-subtle, #f1f5f9)", borderRadius: "8px", marginBottom: "16px", fontSize: "13px" }}>
              <Icon name="pin" size={16} />
              <span><strong>Area filter:</strong> Discoveries within 1.5 km of {result.session.queryPreferences.Eat.locationQuery?.replace(/^Near\s+/i, "") || "selected cultural anchor"}.</span>
            </div>
          )}
          <div className="discovery-grid">
            {(previewLimit === 3
              ? (() => {
                  const cards = result.cards.filter(c => c.section === s);
                  const preview = threeChoices(cards);
                  const shown = new Set(preview.map(choice => choice.card.id));
                  return expanded[s]
                    ? [...preview, ...cards.filter(card => !shown.has(card.id)).map(card => ({card,label:"",reason:""}))]
                    : preview;
                })()
              : result.cards.filter(c => c.section === s).slice(0, expanded[s] ? undefined : previewLimit).map(card => ({card,label:"",reason:""})))
              .map(({card: c, label, reason}) => (
                <div className="shortlist-choice" key={c.id}>
                {label && <p className="shortlist-label" title={reason}>{label}<small>{reason}</small></p>}
                <DiscoveryCard
                  session={result.agent}
                  key={c.id}
                  card={c}
                  feedback={feedback[c.id]}
                  onFeedback={onFeedback}
                  live={Boolean(result.agent)}
                  disabled={updating.length > 0}
                />
                </div>
              ))}
          </div>
          {result.cards.filter((c) => c.section === s).length >
            previewLimit && (
            <button
              className="quiet-button category-more"
              aria-expanded={Boolean(expanded[s])}
              onClick={() => setExpanded((e) => ({ ...e, [s]: !e[s] }))}
            >
              {expanded[s]
                ? "Show fewer"
                : `See all ${result.cards.filter((c) => c.section === s).length} ${s.toLowerCase()} discoveries`}{" "}
              <Icon name="arrow" size={14} />
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
