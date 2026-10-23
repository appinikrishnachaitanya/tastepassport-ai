"use client";
import { sectionLabel } from "../../src/passport/labels";

import type { Card } from "../../src/passport/model";
import { isPlaceSection } from "../../src/passport/model";
import { formatReturnedRating } from "../../src/passport/rating-display";
import { chatReason } from "../../src/agent/chat-shortlist";
import { Icon } from "./passport";

export default function ChatRecommendations({cards,city,busy,savedIds,onAsk,onSave}:{
  cards:Card[];
  city:string;
  busy:boolean;
  savedIds:string[];
  onAsk:(question:string)=>void;
  onSave:(id:string)=>void;
}) {
  if(!cards.length)return null;
  return <div className="chat-recommendations" aria-label="Choices from your Passport">
    {cards.map((card,index)=>{
      const rating=formatReturnedRating(card.intelligence?.quality?.businessRating);
      const place=isPlaceSection(card.section);
      const location=card.address ?? card.intelligence?.location?.address;
      const saved=savedIds.includes(card.id);
      return <article key={card.id}>
        <span className="chat-choice-category">{index+1} · {card.section==="Music"?"Artist discovery":sectionLabel(card.section)}</span>
        <h3>{card.name}</h3>
        {(location || rating) && <p className="chat-choice-details">{location}{location && rating?" · ":""}{rating?`★ ${rating}/5`:""}</p>}
        <p className="chat-choice-reason">{chatReason(card)}</p>
        <div className="chat-choice-actions">
          <button type="button" disabled={busy} onClick={()=>onAsk(`Why did you recommend ${card.name}?`)}>Why this one?</button>
          <button type="button" disabled={busy || saved} onClick={()=>onSave(card.id)}><Icon name="heart" size={14}/>{saved?"In My Vibe":"Save to My Vibe"}</button>
          <a href={place ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([card.name,location,city].filter(Boolean).join(', '))}` : `https://www.google.com/search?q=${encodeURIComponent(card.name+' '+card.section)}`} target="_blank" rel="noreferrer">{place?"View place ↗":"Explore this ↗"}</a>
        </div>
      </article>;
    })}
    <small className="chat-recommendation-note">From your returned Passport discoveries. Check current prices, hours and availability before going.</small>
  </div>;
}
