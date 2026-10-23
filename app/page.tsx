"use client";
import { refinementErrorMessage } from "../src/agent/customer-error";
import { sectionLabel } from "../src/passport/labels";
import { useEffect, useRef, useState } from "react";
import { validDestination } from "../src/workspace/location";
import { AgentTurnError, sendAgentTurn } from "../src/agent/browser";
import type { Intent } from "../src/agent/types";
import type { AgentInput, Constraint } from "../src/agent/types";
import { FamiliarityControl, ModelComparison } from "./components/cultural";
import GuidedRefinement, { RefinementRecovery } from "./components/guided";
import FeedbackDialog from "./components/feedback";
import type { Section } from "../src/passport/model";
import type { Candidate } from "../src/passport/model";
import {
  confirmed,
  extractDraft,
  typeLabel,
  onboardingTastes,
  passportView,
} from "../src/workspace/state";
import type { Passport, Phase, Resolution } from "../src/workspace/state";
import {
  Icon,
  PassportSections,
  TasteDNA,
  TranslationMap,
} from "./components/passport";
import type { Feedback } from "./components/passport";
import Disambiguation from "./components/disambiguation";
import {
  MoveForm,
  TasteConfirmation,
  StepIndicator,
} from "./components/onboarding";
import ConciergeDrawer from "./components/concierge";
import ChatRecommendations from "./components/chat-recommendations";
import ConceptClarification from "./components/concept-clarification";
import DiscoveryConcierge from "./components/discovery-concierge";
import PassportNavigation from "./components/passport-navigation";
import { reviewMatches } from "../src/passport/matching";
import AccountControl from "./components/account";
import ReusableTastes from "./components/taste-profile";
import DayOutPlan from "./components/day-out";
import TasteIntelligence from "./components/intelligence";
import { JourneyLoading, ToastNotice } from "./components/status";
import {
  PassportCover,
  SavedDiscoveries,
} from "./components/passport-overview";
import { sectionOrder } from "../src/workspace/state";
import TasteAnalysis from "./components/taste-analysis";
import { rememberGuestPassport, restoreGuestPassport, clearGuestPassport } from "../src/workspace/guest-recovery";
import { rememberActiveSession, restoreActiveSession, clearActiveSession, rememberSavedSession, restoreSavedSession, clearSavedSession } from "../src/workspace/active-session";
import { showNotice } from "../src/account/browser";
import { saveOnboardingDraft, restoreOnboardingDraft, clearOnboardingDraft } from "../src/workspace/draft-recovery";
import type { Familiarity } from "../src/passport/evidence";
import type { SavedPlan } from "../src/account/plans";
interface Message {
  role: "agent" | "user";
  text: string;
  recommendationIds?: string[];
}
const welcome: Message = {
  role: "agent",
  text: "Move anywhere. Keep your vibe. Tell me your new city and one to five cultural tastes you love. We’ll build a bridge between your world and your next chapter.",
};
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(95_000),
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}
export default function Home() {
  const [tasteDraftVersion,setTasteDraftVersion]=useState(0);
  const [saveTastePrompt,setSaveTastePrompt]=useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [adaptation, setAdaptation] = useState("");
  const [recoveryStatus, setRecoveryStatus] = useState<"checking" | "expired" | "unavailable">();
  const [city, setCity] = useState("");
  const [origin, setOrigin] = useState("");
  const [initialMode, setInitialMode] = useState<Familiarity>("familiar");
  const [requestedActivities, setRequestedActivities] = useState<Section[]>([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantTab, setAssistantTab] = useState<"ask" | "manual">("ask");
  const [composer, setComposer] = useState("");
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [draft, setDraft] = useState<string[]>([]);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [editingPlan, setEditingPlan] = useState<{plan:SavedPlan;nonce:number}>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [resolution, setResolution] = useState<Resolution>();
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [removed, setRemoved] = useState<number[]>([]);
  const [result, setResult] = useState<Passport>();
  const [workspaceView, setWorkspaceView] = useState<
    "discover" | "plan" | "preferences" | "together" | "connections"
  >("discover");
  const [accountSignedIn, setAccountSignedIn] = useState(false);
  const [savedSessionId, setSavedSessionId] = useState<string>();
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const recoveryRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    setSavedSessionId(restoreSavedSession(window.sessionStorage));
    if (!restoreGuestPassport(window.sessionStorage)) {
      const saved = restoreOnboardingDraft(window.sessionStorage);
      if (saved) {
        setCity(saved.city);
        setOrigin(saved.origin);
        setDraft(saved.tastes);
        setRequestedActivities(saved.activities);
        setAdaptation("Your unfinished taste draft was restored in this tab. Check it before finding matches.");
      }
    }
    setDraftHydrated(true);
  }, []);
  useEffect(() => {
    if (!draftHydrated || result) return;
    saveOnboardingDraft(window.sessionStorage, {city,origin,tastes:draft,activities:requestedActivities});
  }, [draftHydrated,result,city,origin,draft,requestedActivities]);

  // Browser-tab fallback for unexpected React view failures. This is NOT a
  // substitute for shared Supabase session persistence; the server still
  // checks the session revision before any subsequent edit or save.
  useEffect(() => {
    const recovered=restoreGuestPassport(window.sessionStorage);
    if (!recovered) {
      const sessionId=restoreActiveSession(window.sessionStorage);
      if (!sessionId) return;
      const controller=new AbortController();
      void fetch("/api/agent/session", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId}),signal:controller.signal})
        .then(async response=>{
          if (!response.ok) { if(response.status===410)clearActiveSession(window.sessionStorage); return; }
          const data=await response.json();
          if (!controller.signal.aborted && data.passport?.agent?.sessionId===sessionId) {
            setResult(data.passport);setCity(data.passport.city);setDraft(data.passport.selected.map((taste:{name:string})=>taste.name));
            setRequestedActivities((data.passport.session?.activeCategories ?? []).filter((section:Section)=>!data.passport.session?.hiddenCategories.includes(section)));
            setInitialMode(data.passport.session?.discoveryMode ?? "familiar");
            setConstraints(data.passport.session?.constraints ?? []);
            setPhase("ready");setRecoveryStatus(undefined);
          }
        }).catch(()=>{});
      return ()=>controller.abort();
    }
    setResult(current => current ?? recovered);
    setCity(current => current || recovered.city);
    setDraft(recovered.selected.map(taste => taste.name));
    setConceptSeeds(recovered.selected.filter(taste => taste.id.startsWith("urn:tag:")).map(taste => taste.name));
    setRequestedActivities((recovered.session?.activeCategories ?? []).filter(section=>!recovered.session?.hiddenCategories.includes(section)));
    setInitialMode(recovered.session?.discoveryMode ?? "familiar");
    setConstraints(recovered.session?.constraints ?? []);
    setPhase("ready");
    const controller = new AbortController();
    void reconnectPassport(recovered, controller.signal);
    return () => controller.abort();
  }, []);
  async function reconnectPassport(passport: Passport, signal?: AbortSignal) {
    if (!passport.agent) return;
    recoveryRequest.current?.abort();
    const controller = new AbortController();
    recoveryRequest.current = controller;
    const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000), ...(signal ? [signal] : [])]);
    setRecoveryStatus("checking");
    try {
      const response = await fetch("/api/agent/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: passport.agent.sessionId }),
        signal: requestSignal,
      });
      if (signal?.aborted || controller.signal.aborted || recoveryRequest.current !== controller) return;
      if (!response.ok) { setRecoveryStatus(response.status === 410 ? "expired" : "unavailable"); return; }
      const data = await response.json();
      if (!data.passport?.agent || data.passport.agent.sessionId !== passport.agent.sessionId) throw Error();
      setResult(current => current?.agent?.sessionId === passport.agent?.sessionId ? data.passport : current);
      setRecoveryStatus(undefined);
    } catch { if (!signal?.aborted && !controller.signal.aborted && recoveryRequest.current === controller) setRecoveryStatus("unavailable"); }
  }
  // Effects run only after a successful commit. If new results crash a render,
  // the last successfully rendered guest Passport remains recoverable.
  useEffect(() => {
    if (accountSignedIn) {
      if (result?.agent) rememberActiveSession(window.sessionStorage, result.agent.sessionId);
      clearGuestPassport(window.sessionStorage);
      return;
    }
    if (result) rememberGuestPassport(window.sessionStorage, result);
  }, [result, accountSignedIn]);
  useEffect(() => {
    if (!accountSignedIn || !result?.agent || savedSessionId !== result.agent.sessionId) return;
    const { sessionId, revision } = result.agent;
    const timer = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.catch(()=>{}).then(async () => {
        const response = await fetch("/api/account/passports", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save",sessionId,revision})});
        if (!response.ok && response.status !== 409) showNotice("Your latest Passport changes could not be saved. Use Save Passport to try again.","error");
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [accountSignedIn, result, savedSessionId]);

  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<number>();
  const [editing, setEditing] = useState(false);
  const [constraints, setConstraints] = useState<Constraint[]>([]);
  const [conceptSeeds, setConceptSeeds] = useState<string[]>([]);
  const [providerHealth, setProviderHealth] = useState("unconfigured");
  const [updating, setUpdating] = useState<Section[]>([]);
  const [updates, setUpdates] = useState<Partial<Record<Section, number>>>({});
  const [rejectionId, setRejectionId] = useState<string>();
  const [conceptDialog, setConceptDialog] = useState(false);
  const feedbackOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    fetch("/api/agent/capabilities")
      .then((r) => r.json())
      .then((d) => setProviderHealth(d.health))
      .catch(() => {});
  }, []);
  const activeTurn = useRef<AbortController | null>(null);
  const [retryInput, setRetryInput] = useState<AgentInput>();
  const agentScroll = useRef<HTMLDivElement>(null);
  const matchOpener = useRef<HTMLButtonElement>(null);
  function closeDialog() {
    setDialog(undefined);
    requestAnimationFrame(() => matchOpener.current?.focus());
  }
  const busy =
    phase === "resolving" ||
    phase === "exploring" ||
    phase === "refining" ||
    phase === "interpreting";
  const signals = result?.session?.selected ?? confirmed(resolution, chosen);
  const feedback: Record<string, Feedback> = Object.fromEntries(
    (result?.session?.feedback ?? []).map((f) => [
      f.id,
      f.accepted ? "like" : "dislike",
    ]),
  );
  const sessionHistory = result?.session?.history ?? [];
  const conversationStart = sessionHistory.findIndex(
    (message) => message.role === "user",
  );
  const committedMessages = result
    ? conversationStart < 0
      ? []
      : sessionHistory.slice(conversationStart)
    : messages;
  const missingSections = (result?.session?.activeCategories ?? []).filter(section =>
    !result?.session?.hiddenCategories?.includes(section) && !result?.cards.some(card => card.section === section));
  const visibleMessages = retryInput?.message
    ? [
        ...committedMessages,
        { role: "user" as const, text: retryInput.message },
      ]
    : committedMessages;
  const conciergeAvailable =
    providerHealth === "healthy" || providerHealth === "configured";
  const activeItems =
    resolution?.items
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => !removed.includes(index)) ?? [];
  const complete =
    activeItems.length >= 1 &&
    activeItems.every(({ index }) => chosen[index]) &&
    new Set(signals.map((s) => s.id)).size === signals.length;
  useEffect(() => {
    const body = agentScroll.current;
    if (!assistantOpen || !body) return;
    body.scrollTop =
      assistantTab === "ask" ? body.scrollHeight : 0;
  }, [
    assistantOpen,
    assistantTab,
    messages,
    result?.session?.history,
    result?.agent?.pending,
  ]);
  function say(text: string) {
    setMessages((m) => [...m, { role: "agent", text }]);
  }
  function resetMatches(nextPhase: Phase = "review") {
    setResolution(undefined);
    setChosen({});
    setRemoved([]);
    setResult(undefined);
    setPhase(nextPhase);
    setError("");
    setUpdating([]);
  }
  async function submitConversation(event: React.FormEvent) {
    event.preventDefault();
    if (!composer.trim() || busy || recoveryStatus === "checking") return;
    const text = composer.trim();
    setComposer("");
    if (
      result?.agent &&
      !/\b(?:i love|my tastes (?:are|include)|i'm moving|i’m moving)\b/i.test(
        text,
      )
    ) {
      setMessages((m) => [...m, { role: "user", text }]);
      await refine({ message: text });
      return;
    }
    setPhase("interpreting");
    setError("");
    try {
      const interpreted = await post<{
        intent: Intent;
        mode: string;
        health: string;
      }>("/api/agent/interpret", {
        message: text,
        city: city || "New York City",
      });
      const combined = onboardingTastes(interpreted.intent);
      const parsed = {
        city: validDestination(interpreted.intent.destination ?? city) ? (interpreted.intent.destination ?? city) : "",
        tastes: combined.length ? combined : extractDraft(text, city).tastes,
      };
      setConceptSeeds(interpreted.intent.concepts);
      setProviderHealth(interpreted.health);
      setConstraints(interpreted.intent.constraints);
      setMessages((m) => [
        ...m,
        { role: "user", text },
        {
          role: "agent",
          text: `I’ve prepared an editable taste draft for ${parsed.city || "your next city"}. Choose a supported destination and check the phrases below before I look for matching interests.`,
        },
      ]);
      setCity(parsed.city);
      setDraft(parsed.tastes);
      setEditing(true);
      resetMatches();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not interpret the request.",
      );
      setPhase("error");
    }
  }
  async function refine(input: AgentInput) {
    if (!result?.agent || busy || activeTurn.current || recoveryStatus === "checking") return;
    const controller = new AbortController();
    activeTurn.current = controller;
    setRetryInput(input);
    setError("");
    setPhase("refining");
    setUpdating(
      input.feedback
        ? [
            [...result.cards, ...(result.session?.savedCards ?? [])].find(
              (c) => c.id === input.feedback!.id,
            )?.section,
          ].filter((s): s is Section => Boolean(s))
        : [],
    );
    try {
      const reply = await sendAgentTurn(
        result.agent,
        input,
        (event) => {
          const match = event.label.match(
            /(?:Updating|Ranking) your (Eat|Coffee|Music|Culture|Lifestyle) passport/,
          );
          if (match && event.status === "active")
            setUpdating((sections) => [
              ...new Set([...sections, match[1] as Section]),
            ]);
        },
        controller.signal,
      );
      if (controller.signal.aborted || activeTurn.current !== controller) return;
      setRetryInput(undefined);
      const changed = reply.changed;
      const unchanged = sectionOrder.filter(
        (section) =>
          !changed.includes(section) &&
          result.cards.some((c) => c.section === section) &&
          JSON.stringify(result.cards.filter((c) => c.section === section)) ===
            JSON.stringify(
              reply.state.cards.filter((c) => c.section === section),
            ),
      );
      const added = reply.state.cards.filter(
        (c) =>
          changed.includes(c.section) &&
          !result.cards.some((old) => old.id === c.id),
      ).length;
      setAdaptation(
        input.feedback?.accepted
          ? input.feedback.clear
            ? "Removed from My Vibe."
            : "Saved to My Vibe. This real discovery can guide future refinements."
          : changed.length
            ? `Updated ${changed.join(", ")}${added ? ` with ${added} new discoveries` : ""}. ${unchanged.length ? `${unchanged.join(", ")} stayed unchanged.` : ""}`
            : input.reset
              ? "Conversation cleared. Your discoveries and My Vibe are still here."
              : "Your Passport is preserved.",
      );
      setResult(passportView(reply.state, result.explanation));
      setUpdates((u) => {
        const next = { ...u };
        for (const section of reply.changed)
          next[section] = (next[section] ?? 0) + 1;
        return next;
      });
      setProviderHealth(reply.state.providerHealth ?? "unconfigured");
      if (input.reset) {
        setMessages([welcome]);
        setComposer("");
        setConstraints([]);
        setConceptSeeds([]);
        setConceptDialog(false);
        setRejectionId(undefined);
        setUpdates({});
      }
      setPhase("ready");
      if (input.feedback && !input.feedback.accepted)
        requestAnimationFrame(() =>
          document
            .getElementById(`section-${reply.state.feedback.at(-1)?.section}`)
            ?.focus(),
        );
    } catch (e) {
      if (activeTurn.current !== controller) return;
      setError(refinementErrorMessage(e, controller.signal.aborted));
      if ((e instanceof AgentTurnError && ["SESSION_EXPIRED", "SESSION_MISSING"].includes(e.code)) || (e instanceof Error && /session.*expired/i.test(e.message))) {
        setRecoveryStatus("expired");
        setRetryInput(undefined);
      } else if (e instanceof AgentTurnError && e.code === "SESSION_CHANGED") {
        void reconnectPassport(result);
      }
      setPhase("ready");
      say(
        "Your discoveries are still here. You can try your request again or keep exploring.",
      );
    } finally {
      if (activeTurn.current === controller) {
        activeTurn.current = null;
        setPhase("ready");
        setUpdating([]);
      }
    }
  }

  function selectWorkspaceView(next: typeof workspaceView) {
    setWorkspaceView(next);
    requestAnimationFrame(() =>
      document.getElementById(`view-${next === "together" ? "preferences" : next}`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      }),
    );
  }
  async function resolve() {
    const queries = draft.map((s) => s.trim()).filter(Boolean);
    if (
      queries.length < 1 ||
      queries.length > 5 ||
      new Set(queries.map((s) => s.toLowerCase())).size !== queries.length
    ) {
      setError("Keep one to five different tastes in your draft.");
      return;
    }
    resetMatches("resolving");
    setEditing(false);
    say(
      "I’m looking up your cultural signals. You’ll choose the intended match for each taste.",
    );
    try {
      const r = await post<Resolution>("/api/agent/resolve", {
        seeds: queries,
        concepts: conceptSeeds,
      });
      setResolution(r);
      setChosen(reviewMatches(r.items));
      setPhase("confirming");
      say(
        r.items.some((i) => !i.candidates.length)
          ? "Some tastes didn’t return matches. Edit them or remove them, keeping at least one. The available matches are ready to confirm."
          : "Your matches are ready. Confirm each intended entity to bring your taste DNA into focus.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not resolve your tastes.",
      );
      setPhase("error");
      say(
        "The taste lookup couldn’t complete. Your draft is still here; you can retry.",
      );
    }
  }
  function choose(index: number, id: string) {
    setChosen((c) => ({ ...c, [index]: id }));
    closeDialog();
    setResult(undefined);
    setPhase("confirming");
    const item = resolution?.items[index];
    const candidate = item?.candidates.find((c) => c.id === id);
    if (candidate)
      say(`Confirmed ${candidate.name} as ${typeLabel(candidate)}.`);
  }
  function removeSignal(id: string) {
    const entry = Object.entries(chosen).find(([, value]) => value === id);
    if (!entry) {
      const remaining = signals.filter((signal) => signal.id !== id);
      const query = (signal: Candidate) =>
        signal.id.includes(":cuisine:")
          ? `${signal.name} cuisine`
          : signal.name;
      fresh();
      setCity(city);
      setDraft(remaining.map(query));
      setConceptSeeds(
        remaining
          .filter((signal) => signal.id.startsWith("urn:tag:"))
          .map(query),
      );
      setEditing(true);
      setPhase("review");
      say(
        "Taste draft updated. Confirm at least one tastes to rebuild your Passport.",
      );
      return;
    }
    const index = Number(entry[0]);
    const name = signals.find((s) => s.id === id)?.name;
    setChosen((c) => {
      const next = { ...c };
      delete next[index];
      return next;
    });
    setRemoved((r) => [...r, index]);
    setResult(undefined);
    setPhase("confirming");
    say(
      `Removed ${name ?? "that taste"} from the current selection. Keep at least one confirmed tastes to continue.`,
    );
  }
  async function generate() {
    if (!resolution || !complete || busy || !city) return;
    setError("");
    setResult(undefined);
    setUpdating([]);
    setPhase("exploring");
    say(
      `I’m exploring ${city} using your confirmed tastes and chosen activities.`,
    );
    try {
      const r = await post<Passport>("/api/passport", {
        city,
        token: resolution.token,
        ids: signals.map((s) => s.id),
        constraints,
        activities: requestedActivities,
        mode: initialMode,
        // Onboarding progress is not assistant chat history.
        history: [],
      });
      const passport = r;
      setResult(passport);
      setPhase("ready");
      say(
        r.cards.length
          ? `Your passport is ready: ${r.cards.length} discoveries${r.notices.length ? ", with a few categories unavailable" : ""}. Explore what feels like you.`
          : "No suitable discoveries were returned this time. Try editing your tastes or try again.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not build your passport.",
      );
      setPhase("error");
      say(
        "Exploration couldn’t complete. Your confirmed tastes are preserved for a retry.",
      );
    }
  }
  function recordFeedback(id: string, value: Feedback) {
    if (busy) return;
    if (value === "dislike") {
      feedbackOpener.current = document.activeElement as HTMLElement;
      setRejectionId(id);
    } else
      void refine({
        feedback: { id, accepted: true, clear: feedback[id] === "like" },
      });
  }
  function closeFeedback() {
    setRejectionId(undefined);
    requestAnimationFrame(() => feedbackOpener.current?.focus());
  }
  function requestNewPassport() {
    if(result?.agent)setSaveTastePrompt(true);
    else fresh();
  }
  function fresh() {
    recoveryRequest.current?.abort();
    clearGuestPassport(window.sessionStorage);
    clearActiveSession(window.sessionStorage);
    setSavedSessionId(undefined);
    clearOnboardingDraft(window.sessionStorage);
    setSaveTastePrompt(false);
    setTasteDraftVersion(value=>value+1);
    activeTurn.current?.abort();
    activeTurn.current = null;
    setRetryInput(undefined);
    if (result?.agent)
      void fetch("/api/agent/session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: result.agent.sessionId }),
      });
    setRecoveryStatus(undefined);
    setShowSaved(false);
    setWorkspaceView("discover");
    setEditingPlan(undefined);
    setAdaptation("");
    setCity("");
    setOrigin("");
    setInitialMode("familiar");
    setRequestedActivities([]);
    setAssistantOpen(false);
    setAssistantTab("ask");
    setComposer("");
    setMessages([welcome]);
    setDraft([]);
    setConstraints([]);
    setConceptSeeds([]);
    setEditing(false);
    setUpdates({});
    setDialog(undefined);
    setRejectionId(undefined);
    setConceptDialog(false);
    resetMatches("idle");
  }
  const step = result ? 3 : resolution && !editing ? 2 : 1;
  const progress =
    phase === "refining"
      ? updating.length
        ? `Finding a better fit for ${updating.join(", ")}…`
        : "Finding a better fit…"
      : phase === "resolving"
        ? "Resolving cultural signals…"
        : phase === "interpreting"
          ? "Understanding your tastes…"
          : `Exploring ${city} and curating your Passport…`;
  return (
    <main className="app-shell progressive-app">
      <ToastNotice />
      <a href="#passport-content" className="skip-link">
        Skip to main content
      </a>
      <header className="workspace-topbar">
        <a className="brand" href="/" aria-label="TastePassport home" onClick={event=>{if(result){event.preventDefault();requestNewPassport();}}}>
          <span className="brand-symbol">
            <Icon name="star" size={22} />
          </span>
          <span>
            TastePassport <small>AI</small>
          </span>
        </a>
        <span className="topbar-caption">Move anywhere. Keep your vibe.</span>
        <nav className="header-controls" aria-label="Passport actions">
          <AccountControl
            onAccountChange={setAccountSignedIn}
            onPassportSaved={sessionId=>{if(sessionId)rememberSavedSession(window.sessionStorage,sessionId);else clearSavedSession(window.sessionStorage);setSavedSessionId(sessionId);}}
            onEditPlan={plan=>{setEditingPlan(current=>({plan,nonce:(current?.nonce??0)+1}));setWorkspaceView("plan");}}
            passport={result}
            disabled={busy}
            onSignOut={fresh}
            onRestore={(passport) => {
              fresh();
              setResult(passport);
              setCity(passport.city);
              setDraft(passport.selected.map((s) => s.name));
              setRequestedActivities((passport.session?.activeCategories ?? []).filter(section=>!passport.session?.hiddenCategories.includes(section)));
              setInitialMode(passport.session?.discoveryMode ?? "familiar");
              setConstraints(passport.session?.constraints ?? []);
              setPhase("ready");
              setProviderHealth("unconfigured");
              void fetch("/api/agent/capabilities")
                .then((response) => response.json())
                .then((value) => setProviderHealth(value.health))
                .catch(() => {});
              setAdaptation(
                "Your saved Passport is back. Refine a chapter for fresh suggestions.",
              );
            }}
          />
          {result && (
            <div className="topbar-actions">
              <span className="current-city">
                <Icon name="pin" size={14} />
                {city}
              </span>
              <button
                className="quiet-button"
                aria-label="Start a new Passport"
                onClick={requestNewPassport}
                disabled={busy}
              >
                <Icon name="plus" size={14} />
                <span className="new-passport-label">New Passport</span>
                <span className="new-passport-short" aria-hidden="true">
                  New
                </span>
              </button>
            </div>
          )}
        </nav>
      </header>
      <div className="progressive-content" id="passport-content" tabIndex={-1}>
        {<ReusableTastes signedIn={accountSignedIn} passport={result} city={city} draft={draft} disabled={busy} draftVersion={tasteDraftVersion}
          saveRequested={saveTastePrompt} onContinue={fresh} onCancel={()=>setSaveTastePrompt(false)}
          onSelect={profile=>{resetMatches("idle");setDraft(profile.selected.map(s=>s.name));setConceptSeeds(profile.selected.filter(s=>s.id.startsWith("urn:tag:")).map(s=>s.name));setInitialMode(profile.discoveryMode);setConstraints(profile.constraints);setRequestedActivities(profile.activeCategories.filter(s=>!profile.hiddenCategories.includes(s)).slice(0,5));setEditing(true);}}
          onBusy={value=>{if(value)setPhase("exploring");else setPhase(current=>current==="exploring"?"idle":current);}}
          onApply={passport=>{setResult(passport);setCity(passport.city);setDraft(passport.selected.map(s=>s.name));setPhase("ready");setAdaptation("Fresh discoveries using your saved tastes.");}}
        />}
        {!result && <StepIndicator step={step} />}
        {step === 1 && (
          <MoveForm
            city={city}
            origin={origin}
            draft={draft}
            disabled={busy}
            onCity={(value) => {
              setCity(value);
              resetMatches();
            }}
            onOrigin={setOrigin}
            onDraft={(values) => {
              setDraft(values);
              setConceptSeeds(
                values.filter((v) =>
                  /cuisine|coffee|bookstores|culture/i.test(v),
                ),
              );
              resetMatches();
            }}
            onSubmit={resolve}
            activities={requestedActivities}
            onActivities={setRequestedActivities}
          />
        )}
        {step === 2 && resolution && (
          <TasteConfirmation
            items={activeItems}
            chosen={chosen}
            disabled={busy}
            complete={complete}
            mode={initialMode}
            onMode={setInitialMode}
            onChoose={choose}
            onRemove={(index) => {
              setChosen((c) => {
                const next = { ...c };
                delete next[index];
                return next;
              });
              setRemoved((r) => [...r, index]);
            }}
            onReplace={() => setEditing(true)}
            onBack={() => setEditing(true)}
            onSubmit={generate}
          />
        )}
        {error && (
          <div className="error-message progressive-error" role="alert">
            <strong>Let’s try that again.</strong>
            <p>{error}</p>
            {!result && (
              <button
                className="text-button"
                onClick={() =>
                  void (resolution && complete ? generate() : resolve())
                }
                disabled={busy}
              >
                Try again
              </button>
            )}
          </div>
        )}
        {busy && <JourneyLoading phase={phase} detail={progress} />}
        {result && (
          <section
            className="living-passport"
            aria-labelledby="passport-title"
            aria-busy={busy}
          >
            <PassportCover
              passport={result}
              origin={origin}
              onConnections={() => {
                selectWorkspaceView("connections");
              }}
            />
            <div className="passport-workspace">
              <PassportNavigation active={workspaceView === "discover" && showSaved ? "saved" : workspaceView}
                savedCount={result.session?.savedCards.length ?? 0}
                onNavigate={destination=>{
                  setShowSaved(destination === "saved");
                  selectWorkspaceView(destination === "saved" ? "discover" : destination);
                  requestAnimationFrame(()=>document.getElementById("passport-workspace-content")?.focus({preventScroll:true}));
                }}/>
              <div id="passport-workspace-content" className="passport-workspace-content" tabIndex={-1}>
              <button
                className="assistant-launch"
                onClick={() => setAssistantOpen(true)}
                aria-expanded={assistantOpen}
                aria-controls="taste-concierge"
              >
                <Icon name="star" size={18} />
                Ask TastePassport
              </button>
            {recoveryStatus && (
              <section className="passport-recovery" aria-label="Continue your Passport" role="status">
                <Icon name={recoveryStatus === "checking" ? "star" : "refresh"} size={22} />
                <div><strong>{recoveryStatus === "checking" ? "Picking up where you left off…" : recoveryStatus === "expired" ? "Ready for fresh discoveries?" : "Your discoveries are still here."}</strong>
                <p>{recoveryStatus === "checking" ? "You can browse while we reconnect." : recoveryStatus === "expired" ? "Use the same tastes to build a fresh Passport and make changes again, or keep browsing these discoveries." : "We couldn't reconnect right now. Try again to keep refining and saving."}</p></div>
                {recoveryStatus === "expired" && <button className="primary-button" disabled={busy} onClick={()=>{setRecoveryStatus(undefined);void resolve();}}>Refresh with my tastes <Icon name="arrow" size={15}/></button>}
                {recoveryStatus === "unavailable" && <button className="quiet-button" disabled={busy} onClick={()=>void reconnectPassport(result)}>Try reconnecting</button>}
              </section>
            )}
            {adaptation && (
              <div className="adaptation-notice" role="status">
                <Icon name="check" size={16} />
                <span>{adaptation}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss update"
                  onClick={() => setAdaptation("")}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
            )}
            <div
              id="view-discover"
              className="workspace-view-anchor"
              hidden={workspaceView !== "discover"}
            >
              {!showSaved && <DiscoveryConcierge busy={busy} onAsk={request=>{if(request)setComposer(request);setAssistantTab("ask");setAssistantOpen(true);}} onNavigate={selectWorkspaceView} />}
              {result.session && (
                <FamiliarityControl
                  session={result.session}
                  disabled={busy}
                  onChange={(input) => {setShowSaved(false);setWorkspaceView("discover");void refine(input);}}
                />
              )}
            </div>
            {workspaceView === "discover" && !showSaved && missingSections.length > 0 && (
              <section className="missing-discoveries" aria-label="Find more discoveries">
                <h3>Still looking for a few matches</h3>
                <p>We haven’t found matches for {missingSections.map(sectionLabel).join(", ")} yet. Try again, or adjust your preferences. Your other discoveries stay as they are.</p>
                <div>
                  {missingSections.map(section => (
                    <button key={section} className="quiet-button" disabled={busy}
                      onClick={() => void refine({guided:{section,constraints:result.session?.categoryConstraints[section] ?? []}})}>
                      {busy ? "Finding matches…" : `Try ${sectionLabel(section)} again`}
                    </button>
                  ))}
                  <button className="quiet-button" disabled={busy} onClick={() => selectWorkspaceView("preferences")}>Adjust preferences</button>
                </div>
              </section>
            )}
             {result.session && (
              <RefinementRecovery
                session={result.session}
                disabled={busy}
                onApply={(input) => void refine(input)}
              />
            )}
            {result.session?.hiddenCategories.length ? (
              <p className="passport-mode">
                Hidden chapters: {result.session.hiddenCategories.map(sectionLabel).join(", ")}.
                You can bring them back with manual refinement.
              </p>
            ) : null}
            <div hidden={workspaceView !== "discover"}>
              {showSaved ? (
                <SavedDiscoveries
                  cards={result.session?.savedCards ?? []}
                  feedback={feedback}
                  onFeedback={recordFeedback}
                  disabled={busy}
                />
              ) : (
                <>
                  <PassportSections
                    result={{
                      ...result,
                      cards: result.cards.filter(
                        (c) =>
                          !result.session?.hiddenCategories.includes(c.section),
                      ),
                    }}
                    feedback={feedback}
                    onFeedback={recordFeedback}
                    updates={updates}
                    updating={updating}
                  />
                </>
              )}
            </div>
            <div
              id="view-plan"
              className="workspace-panel"
              hidden={workspaceView !== "plan"}
            >
              <DayOutPlan
                key={`day-out:${result.session?.id ?? result.city}`}
                editPlan={editingPlan}
                expanded={workspaceView === "plan"}
                onFindActivity={id=>{const target=id==="Cinema"?"cinemas":id==="Nightlife"?"nightclubs":id==="Coffee"?"coffee shops":id==="Eat"?"restaurants":"museums";const kept=id==="Coffee"?"dining, music and movies":id==="Eat"?"coffee, music and movies":"dining, coffee, music and movies";void refine({message:`Find local ${target} for this outing. Keep my ${kept} unchanged.`});}}
                passport={result}
                disabled={busy}
                signedIn={accountSignedIn}
              />
            </div>
            <div
              className="workspace-panel"
              id="view-preferences"
              hidden={workspaceView !== "preferences" && workspaceView !== "together"}
            >
              <TasteIntelligence
                key={`intelligence:${result.session?.id ?? result.city}`}
                view={workspaceView === "together" ? "together" : "preferences"}
                onPreferences={()=>selectWorkspaceView("preferences")}
                passport={result}
                busy={busy}
                onRefine={(input) => {setWorkspaceView("discover");setShowSaved(false);void refine(input);}}
              />

            </div>
            <div
              className="workspace-panel"
              id="view-connections"
              hidden={workspaceView !== "connections"}
            >
              <details
                className="secondary-reveal cultural-reveal"
                open={workspaceView === "connections"}
              >
                <summary>
                  Explore your taste patterns <Icon name="arrow" size={16} />
                </summary>
                <TasteAnalysis key={`analysis:${result.session?.id ?? result.city}`} passport={result} busy={busy} onRefine={input=>{setWorkspaceView("discover");void refine(input);}}/>
                {process.env.NODE_ENV === "development" && (
                  <details className="all-query-routes">
                    <summary>Technical recommendation details</summary>
                    <TranslationMap signals={signals} result={result} />
                  </details>
                )}
                <TasteDNA
                  signals={signals}
                  onRemove={removeSignal}
                  disabled={busy}
                />
              </details>
            </div>
            {result.session &&
              process.env.NODE_ENV === "development" &&
              conciergeAvailable &&
              result.session.comparison && (
                <details className="secondary-reveal comparison-reveal">
                  <summary>
                    Compare recommendation approaches{" "}
                    <Icon name="arrow" size={16} />
                  </summary>
                  <ModelComparison
                    key={result.session.id}
                    session={result.session}
                    available={conciergeAvailable}
                  />
                </details>
              )}
              </div>
            </div>
          </section>
        )}
      </div>
      <footer className="workspace-footer">
        <span>Move anywhere. Keep your vibe.</span>
        <nav aria-label="About TastePassport">
          <a href="/about">About us</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </footer>
      {result && (
        <ConciergeDrawer
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
        >
          <div
            className="concierge-tabs"
            role="tablist"
            aria-label="Refinement method"
          >
            <button
              role="tab"
              id="ask-tab"
              aria-controls="ask-panel"
              aria-selected={assistantTab === "ask"}
              onClick={() => setAssistantTab("ask")}
            >
              Ask
            </button>
            <button
              role="tab"
              id="manual-tab"
              aria-controls="manual-panel"
              aria-selected={assistantTab === "manual"}
              onClick={() => setAssistantTab("manual")}
            >
              Adjust filters
            </button>
          </div>
          <div className="concierge-body" ref={agentScroll}>

            {assistantTab === "ask" ? (
              <div id="ask-panel" role="tabpanel" aria-labelledby="ask-tab">
                <p className="concierge-intro">
                  Ask a follow-up, refine one category, or get help choosing your next stop.
                </p>
                {!conciergeAvailable && (
                  <p className="helper">
                    Live chat is unavailable. Use Adjust filters to keep
                    exploring.
                  </p>
                )}
                {!visibleMessages.length && (
                  <div
                    className="concierge-starters"
                    aria-label="Suggested requests"
                  >
                    <span className="micro-label">TRY A REQUEST</span>
                    {[
                      "Find somewhere quieter to eat",
                      "Show me something cultural",
                      "Help me explore a little further",
                    ].map((text) => (
                      <button
                        key={text}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setComposer(text);
                          document
                            .querySelector<HTMLTextAreaElement>(
                              "#conversation-input",
                            )
                            ?.focus();
                        }}
                      >
                        {text} <Icon name="arrow" size={15} />
                      </button>
                    ))}
                  </div>
                )}
                <div
                  className="conversation"
                  aria-label="Conversation history"
                  role="log"
                  aria-live="polite"
                >
                  {visibleMessages.map((m, i) => (
                    <div className={`message ${m.role}`} key={i}>
                      <span className="message-label">
                        {m.role === "agent" ? "TASTEPASSPORT" : "YOU"}
                      </span>
                      <p>{m.role==='agent' && m.recommendationIds?.length ? m.text.split(/\n\nHere are \d+ choices to consider:|\n\n1\. /)[0] : m.text}</p>
                      {m.role === "agent" && Array.isArray(m.recommendationIds) && m.recommendationIds.length ? <ChatRecommendations city={result.city}
                        cards={m.recommendationIds.flatMap(id=>result.cards.find(card=>card.id===id && !result.session?.hiddenCategories?.includes(card.section)) ?? [])}
                        busy={busy} savedIds={result.session?.savedCards?.map(card=>card.id) ?? []}
                        onAsk={question=>void refine({message:question})}
                        onSave={id=>recordFeedback(id,"like")}/> : null}
                      {m.role === "agent" && i === visibleMessages.findLastIndex(message => message.role === "agent") && <>
                        {result.session?.pending && <ConceptClarification pending={result.session.pending} disabled={busy}
                          onChoose={id=>void refine({tagChoice:id})} onSkip={()=>void refine({message:"Skip this concept"})}/>}
                        {!result.agent?.pending && Boolean(result.session?.recovery?.length) && result.session && <>
                          <RefinementRecovery session={result.session} disabled={busy} onApply={input=>void refine(input)}/>
                          <button className="quiet-button" disabled={busy} onClick={()=>{setAssistantOpen(false);selectWorkspaceView("preferences");}}>Adjust preferences</button>
                        </>}
                      </>}
                    </div>
                  ))}
                </div>
                {visibleMessages.length>0 && !busy && !result.agent?.pending && <div className="chat-next-actions" aria-label="Continue your conversation">
                  {["Pick three things across my interests","Compare the first and second choices","What filters are saved?"].map(question=><button type="button" key={question} onClick={()=>{setComposer(question);document.querySelector<HTMLTextAreaElement>("#conversation-input")?.focus();}}>{question}</button>)}
                </div>}
              </div>
            ) : (
              <div
                id="manual-panel"
                role="tabpanel"
                aria-labelledby="manual-tab"
              >
                        {result.session?.pending && <ConceptClarification pending={result.session.pending} disabled={busy}
                          onChoose={id=>void refine({tagChoice:id})} onSkip={()=>void refine({message:"Skip this concept"})}/>}
                {result.session && (
                  <GuidedRefinement
                    session={result.session}
                    disabled={busy}
                    onApply={(input) => void refine(input)}
                  />
                )}
              </div>
            )}
          </div>
          {assistantTab === "ask" && (
            <>
              {phase === "refining" && (
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => activeTurn.current?.abort()}
                >
                  Cancel refinement
                </button>
              )}
              {error && !busy && <div className="conversation-recovery" role="alert">
                <p>{error}</p>
                <div>
                  {retryInput && <button type="button" className="primary-button" disabled={recoveryStatus === "checking"} onClick={()=>void refine(retryInput)}>{recoveryStatus === "checking" ? "Reconnecting…" : "Try my request again"}</button>}
                  {recoveryStatus === "expired" && <button type="button" className="primary-button" onClick={()=>{setAssistantOpen(false);setRecoveryStatus(undefined);void resolve();}}>Refresh with my tastes</button>}
                  <button type="button" className="quiet-button" onClick={()=>{setError("");setRetryInput(undefined);setAssistantOpen(false);}}>Keep exploring</button>
                </div>
              </div>}
              <form className="composer" onSubmit={submitConversation}>
                <label htmlFor="conversation-input" className="sr-only">
                  Ask TastePassport
                </label>
                <textarea
                  id="conversation-input"
                  placeholder="Show me something quieter…"
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  disabled={busy}
                  maxLength={1000}
                  rows={2}
                />
                <div className="composer-footer">
                  <span>Updates your current suggestions</span>
                  <button
                    type="submit"
                    aria-label="Send message"
                    disabled={busy || recoveryStatus === "checking" || !composer.trim()}
                  >
                    <Icon name="send" size={17} />
                    Send
                  </button>
                </div>
              </form>
            </>
          )}
          {visibleMessages.length > 0 && (
            <button
              className="text-button reset-conversation"
              disabled={busy}
              onClick={() => void refine({ reset: "conversation" })}
            >
              Reset conversation
            </button>
          )}
        </ConciergeDrawer>
      )}
      {rejectionId &&
        [...(result?.cards ?? []), ...(result?.session?.savedCards ?? [])].find(
          (c) => c.id === rejectionId,
        ) && (
          <FeedbackDialog
            card={
              [
                ...(result?.cards ?? []),
                ...(result?.session?.savedCards ?? []),
              ].find((c) => c.id === rejectionId)!
            }
            onClose={closeFeedback}
            onSubmit={(reason, detail) => {
              setRejectionId(undefined);
              void refine({
                feedback: { id: rejectionId, accepted: false, reason, detail },
              });
            }}
          />
        )}
      {conceptDialog && result?.agent?.pending && (
        <Disambiguation
          item={result.agent.pending}
          onClose={() => {
            setConceptDialog(false);
            requestAnimationFrame(() => matchOpener.current?.focus());
          }}
          onConfirm={(id) => {
            setConceptDialog(false);
            void refine({ tagChoice: id });
          }}
        />
      )}
      {dialog !== undefined && resolution && (
        <Disambiguation
          key={dialog}
          item={resolution.items[dialog]}
          current={chosen[dialog]}
          onConfirm={(id) => choose(dialog, id)}
          onClose={closeDialog}
        />
      )}
    </main>
  );
}
