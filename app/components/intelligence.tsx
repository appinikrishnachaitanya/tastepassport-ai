"use client";
import { sectionLabel } from "../../src/passport/labels";
import { useEffect, useState } from "react";
import type { Passport, Resolution } from "../../src/workspace/state";
import { activeCategories } from "../../src/passport/active-categories";
import { sectionOrder } from "../../src/workspace/state";
import type { AgentInput } from "../../src/agent/types";
import type { Card, Section } from "../../src/passport/model";
import type { TasteComparison } from "../../src/qloo/compare";
import type { DiscoveryGoal, QueryPreferences } from "../../src/qloo/query-plan";
import { ResultMetrics, WhyEvidence } from "./intelligence-evidence";
import { priceLabel } from "../../src/passport/pricing";
import { suggestedMatches } from "../../src/passport/matching";
import { isPlaceSection } from "../../src/passport/model";
import { Icon } from "./passport";
const modes: { id: DiscoveryGoal; name: string; detail: string; icon: string }[] = [
  {
    id: "discover",
    name: "For you",
    detail: "Recommendations shaped by your confirmed interests.",
    icon: "heart",
  },
  {
    id: "trending",
    name: "Trending for you",
    detail:
      "Taste-led suggestions with trend ranking; this does not show popularity history.",
    icon: "star",
  },
  {
    id: "hidden-gems",
    name: "Hidden gems",
    detail: "Favor quality signals and exclude the most popular results when data is available.",
    icon: "globe",
  },
  {
    id: "safe-bets",
    name: "Safe bets",
    detail: "For places, require a listed rating of at least 4/5 and favor quality signals.",
    icon: "check",
  },
  {
    id: "surprise",
    name: "Surprise me",
    detail: "Explore broader cultural connections while keeping your explicit requirements.",
    icon: "arrow",
  },
];
export default function TasteIntelligence({
  passport,
  busy,
  onRefine,
  view = "preferences",
  onPreferences,
}: {
  passport: Passport;
  busy: boolean;
  onRefine: (input: AgentInput) => void;
  view?: "preferences" | "together";
  onPreferences?: () => void;
}) {
  const [section, setSection] = useState<Section>(()=>sectionOrder.find(s=>passport.cards.some(c=>c.section===s)) ?? "Eat");
  const available=activeCategories(passport.session,passport.cards);
  const availableKey=available.join(",");
  useEffect(()=>{if(available.length&&!available.includes(section))setSection(available[0]);},[availableKey,section]);
  const prefs = passport.session?.queryPreferences?.[section];
  const [goal, setGoal] = useState<DiscoveryGoal>(
    () => prefs?.goal ?? "discover",
  );
  const [price, setPrice] = useState(() => prefs?.priceMax?.toString() ?? "4");
  const [rating, setRating] = useState(
    () => prefs?.businessRatingMin?.toString() ?? "",
  );
  const [area, setArea] = useState(prefs?.locationQuery ?? ""),
    [avoidArea, setAvoidArea] = useState(prefs?.excludeLocation ?? ""),
    [source, setSource] = useState(prefs?.requiredExternalSources?.[0] ?? ""),
    [reviews, setReviews] = useState(prefs?.tripAdvisorReviewCountMin?.toString() ?? "");
  const preferenceSnapshot = JSON.stringify(prefs ?? {});
  useEffect(() => {
    const current: QueryPreferences = JSON.parse(preferenceSnapshot);
    setGoal(current.goal ?? "discover");
    setPrice(current.priceMax?.toString() ?? "4");
    setRating(current.businessRatingMin?.toString() ?? "");
    setArea(current.locationQuery ?? "");
    setAvoidArea(current.excludeLocation ?? "");
    setSource(current.requiredExternalSources?.[0] ?? "");
    setReviews(current.tripAdvisorReviewCountMin?.toString() ?? "");
  }, [section, preferenceSnapshot, passport.agent?.revision]);
  const [partner, setPartner] = useState([""]);
  const [expandedMatch, setExpandedMatch] = useState<number>();
  const [resolution, setResolution] = useState<Resolution>();
  const [ids, setIds] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [together, setTogether] = useState<{
    comparison: TasteComparison;
    cards: Card[];
    notice: string;
  }>();
  const [debug, setDebug] = useState<unknown>();
  const hasEntityProfile = passport.selected.some(candidate => !candidate.id.startsWith("urn:tag:"));
  async function post(path: string, body: unknown) {
    const r = await fetch(path, {
      signal: AbortSignal.timeout(75_000),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const b = await r.json();
    if (!r.ok) throw Error(b.error ?? "Please try again.");
    return b;
  }
  async function resolvePartner() {
    setLoading(true);
    setError("");
    setTogether(undefined);
    try {
      const matches = await post("/api/agent/resolve", { seeds: partner.map(value=>value.trim()).filter(Boolean) });
      setResolution(matches);
      setExpandedMatch(undefined);
      setIds(suggestedMatches(matches.items.map((item: Resolution["items"][number]) => ({ ...item, candidates: item.candidates.filter(candidate => !candidate.id.startsWith("urn:tag:")) }))));
    } catch {
      setError(
        "Could not find that interest. Try a specific artist, film, book or brand.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function commonGround() {
    if (!passport.agent || !resolution) return;
    setLoading(true);
    setError("");
    try {
      setTogether(
        await post("/api/agent/intelligence", {
          ...passport.agent,
          action: "together",
          token: resolution.token,
          ids: Object.values(ids),
          section,
        }),
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Comparison is unavailable. Your Passport is preserved.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="taste-intelligence" aria-label={view === "together" ? "Together" : "Your discovery preferences"}>
      <div className="intelligence-content">
        <div className="intelligence-intro"><div><span className="micro-label">{view === "together" ? "TOGETHER" : "MAKE IT YOURS"}</span><h2>{view === "together" ? "Find your next yes, together." : "Your city. Your kind of day."}</h2><p>{view === "together" ? "One thing they love is enough to find a shared starting point." : "Fine-tune one category in Discover. Your other discoveries stay put."}</p></div><span className="intelligence-intro-mark" aria-hidden="true"><Icon name={view === "together" ? "People" : "sliders"} size={44}/></span></div>
        <label className="intelligence-section">
          What are we looking for?
          <select
            value={section}
            disabled={busy || loading}
            onChange={(e) => {
              setSection(e.target.value as Section);
              const next =
                passport.session?.queryPreferences?.[e.target.value as Section];
              setGoal(next?.goal ?? "discover");
              setPrice(next?.priceMax?.toString() ?? "4");
              setRating(next?.businessRatingMin?.toString() ?? "");
              setArea(next?.locationQuery ?? "");
              setAvoidArea(next?.excludeLocation ?? "");
              setSource(next?.requiredExternalSources?.[0] ?? "");
              setReviews(next?.tripAdvisorReviewCountMin?.toString() ?? "");
              setTogether(undefined);
            }}
          >
            {available
              .map((s) => (
                <option key={s} value={s}>{sectionLabel(s)}</option>
              ))}
          </select>
        </label>
        <form
          hidden={view !== "preferences"}
          className="intelligence-preferences"
          onSubmit={(e) => {
            e.preventDefault();
            onRefine({
              discovery: {
                section,
                preferences: {
                  goal,
                  ...(price ? { priceMax: Number(price) } : {}),
                  ...(rating ? { businessRatingMin: Number(rating) } : {}),
                  ...(area.trim()
                    ? { locationQuery: area.trim(), radius: 0 }
                    : {}),
                  ...(avoidArea.trim()
                    ? { excludeLocation: avoidArea.trim() }
                    : {}),
                  ...(source ? { requiredExternalSources: [source] } : {}),
                  ...(reviews
                    ? { tripAdvisorReviewCountMin: Number(reviews) }
                    : {}),
                },
              },
            });
          }}
        >
          <div className="preference-section-heading"><span className="micro-label">CHOOSE THE FEEL</span><strong>What sounds good today?</strong></div>
          <div
            className="intelligence-modes"
            role="group"
            aria-label="Discovery style"
          >
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={busy || loading}
                aria-pressed={goal === m.id}
                onClick={() => setGoal(m.id)}
              >
                <Icon name={m.icon} size={21}/><strong>{m.name}</strong><small>{m.detail}</small>
              </button>
            ))}
          </div>
          <p className="sr-only">{modes.find((m) => m.id === goal)?.detail} Choose Update suggestions to apply it.</p>
          {isPlaceSection(section) && (
            <div className="intelligence-filters"><div className="preference-section-heading"><span className="micro-label">MAKE IT PRACTICAL</span><strong>Set your limits</strong></div>
              <label>
                Maximum budget
                <select
                  value={price}
                  aria-label="Maximum price"
                  onChange={(e) => {
                    const value = e.target.value;
                    setPrice(value);
                    // This form has one explicit Apply action. Changing a select
                    // must never launch an unseen overlapping refinement.
                  }}
                  disabled={busy || loading}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option value={n} key={n}>
                      {n === 4
                        ? "Any budget"
                        : `${priceLabel(n)}${n > 1 ? " or less" : ""}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Minimum rating
                <select
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                  disabled={busy || loading}
                >
                  <option value="">Keep current preference</option>
                  <option value="4">4 / 5</option>
                  <option value="4.5">4.5 / 5</option>
                </select>
              </label>
            </div>
          )}
          {isPlaceSection(section) && (
            <details className="advanced-taste-filters">
              <summary>Location and more preferences</summary>
              <p className="helper">
                Use named areas within {passport.city}. Exclusions are resolved
                by the recommendation service; ambiguous areas may need a more
                specific name. Provider listings do not establish booking
                availability.
              </p>
              <div className="intelligence-filters">
                <label>
                  Only in this area
                  <input
                    maxLength={100}
                    value={area}
                    placeholder="Keep current area"
                    disabled={busy || loading}
                    onChange={(e) => setArea(e.target.value)}
                  />
                </label>
                <label>
                  Avoid this area
                  <input
                    maxLength={100}
                    value={avoidArea}
                    placeholder="A named neighborhood"
                    disabled={busy || loading}
                    onChange={(e) => setAvoidArea(e.target.value)}
                  />
                </label>
                <label>
                  Provider listing
                  <select
                    value={source}
                    disabled={busy || loading}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="">Keep current preference</option>
                    <option value="michelin">Michelin listing</option>
                    <option value="resy">Resy listing</option>
                    <option value="tablet">Tablet listing</option>
                  </select>
                </label>
                <label>
                  Minimum Tripadvisor review count
                  <input
                    type="number"
                    min="0"
                    max="10000000"
                    step="1"
                    value={reviews}
                    placeholder="Keep current preference"
                    disabled={busy || loading}
                    onChange={(e) => setReviews(e.target.value)}
                  />
                </label>
              </div>
            </details>
          )}
          {prefs && (
            <p className="active-preferences">
              <strong>Currently in Discover</strong><span>{modes.find(m=>m.id===(prefs.goal??"discover"))?.name ?? "For you"}</span>
              {prefs.priceMax && prefs.priceMax < 4 ? ` · ${priceLabel(prefs.priceMax)} or less` : " · No maximum budget"}
              {prefs.priceMin ? ` · minimum ${priceLabel(prefs.priceMin)}` : ""}
              {prefs.businessRatingMin
                ? ` · business rating ≥ ${prefs.businessRatingMin}`
                : ""}
              {prefs.locationQuery ? ` · in ${prefs.locationQuery}` : ""}
              {prefs.excludeLocation ? ` · excluding ${prefs.excludeLocation}` : ""}
              {prefs.requiredExternalSources?.length ? ` · requested listing: ${prefs.requiredExternalSources.join(", ")} (availability not verified)` : ""}
              {prefs.tripAdvisorReviewCountMin !== undefined ? ` · at least ${prefs.tripAdvisorReviewCountMin} Tripadvisor reviews requested` : ""}. Your
              other categories stay unchanged.
            </p>
          )}
          <button
            className="primary-button intelligence-apply"
            disabled={busy || loading || !passport.agent}
          >
            {busy ? "Finding your next fit…" : <>Update suggestions <Icon name="arrow" size={17}/></>}
          </button>
        </form>
        <section className="together-reveal" hidden={view !== "together"} aria-label="Find common ground">
          <div className="together-preference-summary"><div><strong>{sectionLabel(section)} in {passport.city}</strong><p className="helper">Your current preferences for this category carry into the shared search{prefs?.priceMax && prefs.priceMax < 4 ? ` · ${priceLabel(prefs.priceMax)} or less` : ""}{prefs?.businessRatingMin ? ` · rating ${prefs.businessRatingMin}+` : ""}.</p></div><button type="button" className="quiet-button" onClick={onPreferences}>Review preferences</button></div>
          <div className="together-heading"><div><span className="micro-label">A LITTLE OF YOU. A LITTLE OF THEM.</span><h3>What are they into?</h3><p>Pick an artist, film, book or brand they love. We’ll find cultural common ground and suggest {sectionLabel(section).toLowerCase()} in {passport.city}.</p></div><img src="/illustrations/together-passports.svg" width="440" height="260" alt="" aria-hidden="true" loading="lazy" /></div>
          <p className="helper">Start with one. Add more if you like. Your Passport and preferences stay yours.</p>
          {!hasEntityProfile && <p role="status">Add a named artist, film, book or brand to your Passport to use Together.</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void resolvePartner();
            }}
          >
            <div className="partner-interests">
              {partner.map((value, i) => (
                <label key={i}>
                  {i === 0 ? "Something they love" : `Another interest (optional) ${i + 1}`}
                  <input
                    required={i === 0}
                    maxLength={100}
                    value={value}
                    placeholder={["An artist", "A film", "A book or brand"][i]}
                    disabled={busy || loading}
                    onChange={(e) => {
                      setPartner((p) =>
                        p.map((s, j) => (j === i ? e.target.value : s)),
                      );
                      setResolution(undefined);
                      setIds({});
                      setTogether(undefined);
                    }}
                  />
                  {i > 0 && <button type="button" className="text-button" disabled={busy||loading} onClick={()=>{setPartner(current=>current.filter((_,index)=>index!==i));setResolution(undefined);setIds({});setTogether(undefined);}}>Remove</button>}
                </label>
              ))}
            </div>
            {partner.length < 3 && <button type="button" className="quiet-button" disabled={busy||loading} onClick={()=>setPartner(current=>[...current,""])}>Add another interest</button>}
            <button className={resolution ? "quiet-button" : "primary-button"} disabled={busy || loading || !hasEntityProfile}>
              {loading ? "Finding common ground…" : resolution ? "Look up interests again" : "Find their interests"}
            </button>
          </form>
          {resolution && !together && (
            <div className="partner-matches">
              <h3>Are these the interests they meant?</h3><p className="helper">We suggest a match when its name is clear. Tap Change to choose a different result.</p>
              {resolution.items.map((item, i) => (
                <section key={i}>
                  <h4>{item.query}</h4>
                  {ids[i] && expandedMatch!==i ? <div className="partner-selection">
                    <div><strong>{item.candidates.find(c=>c.id===ids[i])?.name}</strong><small>{item.candidates.find(c=>c.id===ids[i])?.detail}</small></div>
                    <button type="button" className="quiet-button" disabled={loading||busy} onClick={()=>setExpandedMatch(i)}>Change match</button>
                  </div> : <div className="partner-choice-list" role="group" aria-label={`Matches for ${item.query}`}>
                    {item.candidates.filter(c=>!c.id.startsWith("urn:tag:")).map(candidate=><button key={candidate.id} type="button" disabled={busy||loading} aria-pressed={ids[i]===candidate.id} onClick={()=>{setIds(v=>({...v,[i]:candidate.id}));setExpandedMatch(undefined);}}><strong>{candidate.name}</strong><small>{candidate.detail}</small></button>)}
                  </div>}
                  {!item.candidates.some(c => !c.id.startsWith("urn:tag:")) && (
                    <p>No named entity match. Use a specific artist, film, book or brand; cuisine concepts cannot be used as the other person's entity profile.</p>
                  )}
                </section>
              ))}
              <button
                className="primary-button"
                disabled={
                  busy ||
                  loading ||
                  Object.keys(ids).length !== resolution.items.length ||
                  new Set(Object.values(ids)).size !== resolution.items.length
                }
                onClick={() => void commonGround()}
              >
                Find something for both of us
              </button>
            </div>
          )}
          {together && (
            <section className="together-results" aria-label="Your common ground">
              <button type="button" className="text-button" onClick={()=>setTogether(undefined)}>Edit confirmed interests</button>
              <div className="shared-story"><span className="micro-label">A SHARED STARTING POINT</span><h3>Here’s what connects you.</h3><p>These themes appeared in the comparison. Use the places below as ideas to explore together.</p></div>
              <div className="common-tags">
                {together.comparison.shared.slice(0, 8).map((t) => (
                  <span key={t.id}>{t.name}</span>
                ))}
              </div>
              <p role="status">{together.notice}</p>
              <details className="together-differences"><summary>See each person’s distinct tastes</summary>
                <p>
                  More your taste:{" "}
                  {together.comparison.aOnly.map((t) => t.name).join(", ") ||
                    "No separate themes available"}
                </p>
                <p>
                  More their taste:{" "}
                  {together.comparison.bOnly.map((t) => t.name).join(", ") ||
                    "No separate themes available"}
                </p>
              </details>
              <div className="together-cards">
                {together.cards.slice(0,6).map((card) => (
                  <article key={card.id}>
                    <span className="shared-result-status">{card.evidence?.strategyNote?.startsWith("Broader local") ? "Broader local option" : card.evidence?.result.tags.some(tag=>together.comparison.shared.some(shared=>shared.id===tag.id)) ? "Shared theme on this result" : "From your shared-interest search"}</span>
                    <h4>{card.name}</h4>
                    <p>{card.address ?? card.section}</p>
                    <ResultMetrics card={card} />
                    <a href={isPlaceSection(card.section) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([card.name,card.address,passport.city].filter(Boolean).join(", "))}` : `https://www.google.com/search?q=${encodeURIComponent(card.name + " " + card.section)}`} target="_blank" rel="noopener noreferrer">{isPlaceSection(card.section) ? "Check location and availability ↗" : "Learn about this discovery ↗"}</a>
                    <details>
                      <summary>Why this works together</summary>
                      <WhyEvidence card={card} />
                    </details>
                  </article>
                ))}
              </div>
            </section>
          )}
          {loading && <p className="together-loading" role="status">Finding connections between both sets of interests…</p>}
          <p className="helper">This is a temporary comparison, not a compatibility score. Check current venue details before going.</p>
        </section>
        {error && <p role="alert">{error}</p>}
        {process.env.NODE_ENV === "development" && (
          <details className="query-debug">
            <summary>Development query inspector</summary>
            <button
              className="quiet-button"
              onClick={() => {
                void post("/api/agent/intelligence", {
                  ...passport.agent,
                  action: "debug",
                })
                  .then(setDebug)
                  .catch(() =>
                    setDebug({
                      message:
                        "Enable QLOO_DEBUG_UI=1 on the development server to inspect private, bounded responses.",
                    }),
                  );
              }}
            >
              Inspect applied queries
            </button>
            {debug !== undefined && <pre>{JSON.stringify(debug, null, 2)}</pre>}
          </details>
        )}
      </div>
    </section>
  );
}
