"use client";
import { useEffect, useRef, useState } from "react";
import type { Passport } from "../../src/workspace/state";
import type { TasteProfile } from "../../src/account/taste-profile";
import type { SavedTasteProfile } from "../../src/account/profile-record";
import { accountRequest, showNotice } from "../../src/account/browser";
import { Icon } from "./passport";
import ConfirmDelete from "./confirm-delete";

export default function ReusableTastes({signedIn,passport,city,draft,disabled,onApply,onBusy,onSelect,draftVersion,saveRequested,onContinue,onCancel}:{
  signedIn:boolean;passport?:Passport;city:string;draft:string[];disabled:boolean;draftVersion:number;
  onApply:(passport:Passport)=>void;onBusy:(busy:boolean)=>void;onSelect:(profile:TasteProfile)=>void;
  saveRequested:boolean;onContinue:()=>void;onCancel:()=>void;
}) {
  const [profiles,setProfiles]=useState<SavedTasteProfile[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [name,setName]=useState("");
  const [loading,setLoading]=useState(false);
  const [libraryLoading,setLibraryLoading]=useState(false);
  const [error,setError]=useState("");
  const [status,setStatus]=useState("");
  const [confirmProfile,setConfirmProfile]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const epoch=useRef(0);
  const profile=profiles.find(p=>p.id===selectedId);
  const profileMatchesDraft=Boolean(profile && profile.profile.selected.length===draft.length && profile.profile.selected.every((taste,index)=>taste.name.toLocaleLowerCase()===draft[index]?.toLocaleLowerCase()));
  useEffect(()=>{
    let active=true;
    async function load() {
      const current=++epoch.current;
      if(!signedIn){setProfiles([]);setSelectedId("");setError("");setStatus("");setLibraryLoading(false);return;}
      setError("");
      setLibraryLoading(true);
      try {
        const data=await accountRequest("/api/account/preferences");
        if(active&&current===epoch.current) {
          const rows:SavedTasteProfile[]=data.profiles ?? (data.profile?[{id:"legacy",name:"My tastes",updated_at:"",profile:data.profile}]:[]);
          setProfiles(rows);
          setSelectedId(id=>rows.some(row=>row.id===id)?id:"");
        }
      } catch(e){if(active&&current===epoch.current)setError(e instanceof Error?e.message:"Saved tastes are unavailable.");}
      finally{if(active&&current===epoch.current)setLibraryLoading(false);}
    }
    void load();
    // signedIn is the single auth trigger; avoid a duplicate event-driven fetch.
    return()=>{active=false;++epoch.current;};
  },[signedIn]);
  useEffect(()=>{setSelectedId("");setStatus("");},[draftVersion]);
  useEffect(()=>{
    const element=dialog.current;
    if(!saveRequested){element?.close();return;}
    setName("");setError("");setStatus("");
    const opener=document.activeElement as HTMLElement|null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    if(element&&!element.open)element.showModal();
    return()=>{element?.close();document.body.style.overflow=previousOverflow;opener?.focus();};
  },[saveRequested]);

  async function save() {
    if(!passport?.agent || !signedIn || !name.trim())return;
    setLoading(true);setError("");const current=epoch.current;
    try {
      const data=await accountRequest("/api/account/preferences",{action:"save",name:name.trim(),...passport.agent});
      if(current!==epoch.current)return;
      const entry:SavedTasteProfile=data.entry ?? {id:"legacy",name:name.trim(),updated_at:"",profile:data.profile};
      setProfiles(rows=>[entry,...rows.filter(row=>row.id!==entry.id&&row.name!==entry.name)]);
      showNotice(`Saved “${entry.name}”. Choose it for your next city.`);
      onContinue();
    }catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:"Your tastes could not be saved. Your current Passport is still here.");}
    finally{setLoading(false);}
  }
  async function run(action:"apply"|"delete") {
    if(!profile)return;
    setLoading(true);setError("");setStatus("");const current=epoch.current;
    if(action==="apply")onBusy(true);
    try {
      const data=await accountRequest("/api/account/preferences",{action,city,...(selectedId!=="legacy"?{profileId:selectedId}:{})},action==="delete"?"DELETE":"POST");
      if(current!==epoch.current)return;
      if(action==="delete"){setProfiles(rows=>rows.filter(row=>row.id!==selectedId));setSelectedId("");setStatus("Taste profile removed. Your current draft is still available.");showNotice("Taste profile deleted.");}
      else{onApply(data.passport);showNotice("Fresh discoveries using your saved tastes.");}
    }catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:"Please try again.");}
    finally{setLoading(false);if(action==="apply")onBusy(false);}
  }
  const existingName=profiles.some(row=>row.name===name.trim());
  return <>
    {signedIn&&!passport&&(profiles.length>0||error) && <section className="reusable-tastes" aria-label="Reusable taste profile">
      <div className="profile-heading"><div><span className="micro-label">YOUR TASTES. YOUR NEXT CITY.</span><h2>Pick up where you left off.</h2></div><span>{profiles.length} saved</span></div>
      <p>Choose a saved profile to load its tastes into the form below. Add or change tastes, then select Find my taste matches to confirm them. You can also discover immediately with the saved preferences.</p>
      <div className="profile-fields"><label>Saved taste profile<select value={selectedId} disabled={disabled||loading} onChange={event=>{
        const selected=profiles.find(row=>row.id===event.target.value);setSelectedId(event.target.value);setError("");
        if(selected){onSelect(selected.profile);setStatus(`Loaded “${selected.name}” into your taste draft. Add another taste or confirm below.`);}
      }}><option value="">Choose a saved profile</option>{profiles.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>
      {libraryLoading&&profiles.length>0&&<p className="helper" role="status">Refreshing your saved tastes…</p>}
      {profile&&<p className="profile-interest-preview">{profile.profile.selected.map(t=>t.name).join(" · ")}</p>}
      <div className="plan-actions">
        {profile&&<button type="button" className="primary-button" disabled={disabled||loading||!city||!profileMatchesDraft} onClick={()=>void run("apply")}>{loading?"Finding fresh matches…":!profileMatchesDraft?"Confirm edited tastes below":city?`Discover in ${city} with saved preferences`:"Choose a city below"}</button>}
        {profile&&<button type="button" className="text-button" disabled={disabled||loading||selectedId==="legacy"} onClick={()=>setConfirmProfile(true)}>Delete profile</button>}
      </div>
      {status&&<p className="profile-status" role="status">{status}</p>}
      {error&&<p role="alert">{error}</p>}
    </section>}
    {confirmProfile&&profile&&<ConfirmDelete title={`Delete “${profile.name}”?`} description="This saved taste profile will be removed. Your current draft stays here." busy={loading} onCancel={()=>setConfirmProfile(false)} onConfirm={()=>{setConfirmProfile(false);void run("delete");}}/>}
    {saveRequested&&<dialog ref={dialog} className="account-dialog taste-profile-dialog" aria-labelledby="save-taste-title" onCancel={event=>{event.preventDefault();if(!loading)onCancel();}}>
      <div className="dialog-header"><span className="micro-label">BEFORE YOUR NEXT CITY</span><button type="button" className="icon-button" aria-label="Keep exploring this Passport" disabled={loading} onClick={onCancel}><Icon name="close" size={20}/></button></div>
      <h2 id="save-taste-title">Take your tastes with you?</h2>
      <p>Save the interests and preferences from your {passport?.city} Passport. Give them a name so you can find them when you explore your next city.</p>
      {signedIn?<form onSubmit={event=>{event.preventDefault();void save();}}>
        <label className="profile-save-name" htmlFor="taste-profile-name">Taste profile name<input id="taste-profile-name" autoFocus required maxLength={80} value={name} disabled={loading} onChange={event=>setName(event.target.value)} placeholder="My weekend favorites"/></label>
        {existingName&&<p className="helper">You already have a profile with this name. Saving will update that profile.</p>}
        {error&&<p role="alert">{error}</p>}
        <div className="profile-save-actions"><button type="submit" className="primary-button" disabled={loading||!name.trim()}>{loading?"Saving your tastes…":existingName?"Update profile & continue":"Save profile & continue"}</button><button type="button" className="quiet-button" disabled={loading} onClick={onContinue}>Continue without saving</button></div>
      </form>:<><p className="helper">Sign in to keep a named taste profile in your account, or continue as a guest.</p><div className="profile-save-actions"><button type="button" className="primary-button" onClick={()=>window.dispatchEvent(new Event("tastepassport:open-account"))}>Sign in to save my tastes</button><button type="button" className="quiet-button" onClick={onContinue}>Continue without saving</button></div></>}
      <p className="helper">This saves your tastes for reuse. Saved Passports keep your discoveries and plans separately.</p>
    </dialog>}
  </>;
}
