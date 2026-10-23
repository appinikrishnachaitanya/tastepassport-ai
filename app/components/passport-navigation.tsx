"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./passport";

export type PassportDestination = "discover" | "saved" | "plan" | "preferences" | "together" | "connections";
const destinations: {id: PassportDestination; label: string; icon: string}[] = [
  {id:"discover",label:"Discover",icon:"globe"},
  {id:"saved",label:"My Vibe",icon:"heart"},
  {id:"plan",label:"Plan a day",icon:"pin"},
  {id:"preferences",label:"Preferences",icon:"sliders"},
  {id:"together",label:"Together",icon:"People"},
  {id:"connections",label:"Taste insights",icon:"star"},
];

export default function PassportNavigation({active,savedCount,onNavigate}:{
  active: PassportDestination;
  savedCount: number;
  onNavigate: (destination: PassportDestination) => void;
}) {
  const [open,setOpen] = useState(false);
  const menuId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(()=>setOpen(false),[active]);

  return (
    <aside className="passport-sidebar" data-menu-open={open} onKeyDown={event=>{
      if(event.key === "Escape" && open) {
        setOpen(false);
        toggle.current?.focus();
      }
    }}>
      <span className="passport-sidebar-title micro-label">YOUR PASSPORT</span>
      <div className="passport-mobile-heading">
        <button ref={toggle} type="button" className="passport-menu-toggle" aria-expanded={open}
          aria-controls={menuId} onClick={()=>setOpen(value=>!value)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            {open ? <path d="m6 6 12 12M6 18 18 6"/> : <path d="M4 6h16M4 12h16M4 18h16"/>}
          </svg>
          Passport menu
        </button>
        <span className="passport-current-view">{destinations.find(item=>item.id===active)?.label}</span>
      </div>
      <nav id={menuId} className="passport-navigation" aria-label="Passport sections">
        {destinations.map(item=>(
          <button key={item.id} type="button" aria-current={active===item.id ? "page" : undefined}
            onClick={()=>{setOpen(false);onNavigate(item.id);}}>
            <Icon name={item.icon} size={19}/>
            <span>{item.label}</span>
            {item.id === "saved" && <span className="passport-saved-count" aria-label={`${savedCount} saved discoveries`}>{savedCount}</span>}
          </button>
        ))}
      </nav>
    </aside>
  );
}
