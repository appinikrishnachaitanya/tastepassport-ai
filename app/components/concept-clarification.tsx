"use client";
import type { AgentState } from "../../src/agent/types";

export default function ConceptClarification({pending,disabled,onChoose,onSkip}:{
  pending:NonNullable<AgentState["pending"]>;
  disabled:boolean;
  onChoose:(id:string)=>void;
  onSkip:()=>void;
}) {
  return <div className="pending-concept">
    <strong>Which meaning fits your request?</strong>
    <p>Choose a match for “{pending.query}”, or tell me what you want instead.</p>
    <div className="pending-match-options" aria-label="Matching interests">
      {pending.candidates.map(candidate=><button key={candidate.id} type="button" disabled={disabled}
        onClick={()=>onChoose(candidate.id)}>{candidate.name}</button>)}
    </div>
    <button className="quiet-button" type="button" disabled={disabled} onClick={onSkip}>None of these — I’ll describe it another way</button>
  </div>;
}
