"use client";
import { sectionLabel } from "../../src/passport/labels";
import { Icon } from "./passport";
import { useEffect, useRef, useState } from 'react';
import type { Passport } from '../../src/workspace/state';
import { activeCategories } from "../../src/passport/active-categories";
import { curatedThemes, themeCategories, relevantThemes } from "../../src/passport/taste-themes";
import type { Section } from '../../src/passport/model';
import type { AgentInput } from '../../src/agent/types';
import { buildAreaGuide } from '../../src/passport/area-guide';
import { formatReturnedRating } from '../../src/passport/rating-display';
import type { AnalysisKind, AnalysisResult } from '../../src/qloo/analysis';

export default function TasteAnalysis({passport,busy,onRefine}:{passport:Passport;busy:boolean;onRefine:(input:AgentInput)=>void}) {
  const [results,setResults]=useState<Partial<Record<AnalysisKind,AnalysisResult>>>({});
  const scope=[passport.agent?.sessionId ?? '',passport.city,...passport.selected.map(i=>i.id)].join('|');
  const latestScope=useRef(scope);
  latestScope.current=scope;
  const [resultScope,setResultScope]=useState(scope);
  const [loading,setLoading]=useState<AnalysisKind>();
  const [error,setError]=useState('');
  const [themeId,setThemeId]=useState('');
  // Start with one interest. Users explicitly choose any other combination.
  const [interestIds,setInterestIds]=useState<string[]>(()=>passport.selected[0]?[passport.selected[0].id]:[]);
  const categories=activeCategories(passport.session,passport.cards);
  const [themeSection,setThemeSection]=useState<Section>(()=>categories.find(section=>section==='Movies') ?? categories[0] ?? 'Eat');
  const active=useRef(false);
  useEffect(()=>{
    setInterestIds(passport.selected[0] ? [passport.selected[0].id] : []);
    setResults({});setResultScope(scope);setThemeId('');setError('');
  },[scope]);

  async function load(kind:AnalysisKind) {
    if(!passport.agent || !interestIds.length || active.current || busy)return;
    active.current=true;setLoading(kind);setError('');
    try {
      const response=await fetch('/api/agent/intelligence',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...passport.agent,action:'analysis',kind,interestIds}),signal:AbortSignal.timeout(65000)});
      const data=await response.json();
      if(!response.ok)throw Error(typeof data.error==='string' ? data.error : 'Analysis is unavailable.');
      if (latestScope.current !== scope) return;
      setResultScope(scope);
      setResults(current=>({...current,[kind]:data.analysis}));
      if(kind==='taste')setThemeId('');
    }catch (e) {if(latestScope.current===scope)setError(e instanceof Error && /session|latest version|changed/i.test(e.message) ? 'Your Passport was updated. Reopen Taste Insights and try again.' : 'Taste Insights could not load right now. Please try again; your Passport is unchanged.');}
    finally {active.current=false;setLoading(undefined);}
  }
  const visible: Partial<Record<AnalysisKind,AnalysisResult>> = scope === resultScope ? results : {};
  const taste=visible.taste?.kind==='taste'?visible.taste:undefined;
  const themes=taste ? relevantThemes(taste.tags, passport.selected.filter(interest=>interestIds.includes(interest.id))) : [];
  const selectedTheme=themes.find(theme=>theme.id===themeId);
  const themeOptions=themeCategories(selectedTheme,categories);
  const effectiveThemeSection=themeOptions.includes(themeSection)?themeSection:themeOptions[0] ?? 'Eat';
  const primaryThemes=curatedThemes(themes);
  const additionalThemes=themes.filter(theme=>!primaryThemes.some(primary=>primary.id===theme.id));
  const heat=visible.heatmap?.kind==='heatmap'?visible.heatmap:undefined;
  const areas=heat ? buildAreaGuide(heat.points,passport.cards) : [];
  function exploreTheme() {
    if (!themeId || busy) return;
    const existing = passport.session?.queryPreferences?.[effectiveThemeSection]?.includeTags ?? [];
    onRefine({discovery:{section:effectiveThemeSection,preferences:{includeTags:[...new Set([...existing,themeId])]}}});
  }
  function nearby(point:{latitude:number;longitude:number}) {
    onRefine({discovery:{section:'Eat',preferences:{locationPoint:`POINT(${point.longitude} ${point.latitude})`,radius:1500}}});
  }
  return <section className="taste-analysis" aria-labelledby="analysis-title">
    <div className="analysis-intro"><span className="analysis-emblem" aria-hidden="true"><Icon name="star" size={28}/></span><div><span className="micro-label">MAKE THE CITY FEEL MORE LIKE YOU</span><h2 id="analysis-title">Find your next direction.</h2><p>Turn what you love into a new direction. Find a theme, or pick a starting place and explore food nearby.</p></div></div>
    <ol className="insight-steps" aria-label="How Taste Insights works"><li><span>01</span>Choose your tastes</li><li><span>02</span>Find a connection</li><li><span>03</span>Explore it in Discover</li></ol>
    <fieldset className="analysis-interest-picker" disabled={busy||Boolean(loading)}>
      <legend>Choose the interests to explore</legend>
      <p>Select one or more of your confirmed interests. Insights are generated for exactly this selection, not every possible combination.</p>
      <div className="analysis-interest-options">
        {passport.selected.map(interest=><label key={interest.id} className={interestIds.includes(interest.id)?"selected":""}>
          <input type="checkbox" checked={interestIds.includes(interest.id)} onChange={event=>{
            setInterestIds(previous=>event.target.checked?[...previous,interest.id]:previous.filter(id=>id!==interest.id));
            setResults({});setThemeId('');setError('');
          }}/><span>{interest.name}</span>
        </label>)}
      </div>
      <div className="analysis-selection-summary"><small>{interestIds.length} of {passport.selected.length} selected</small>{passport.selected.length>1 && interestIds.length<passport.selected.length && <button type="button" onClick={()=>{setInterestIds(passport.selected.map(interest=>interest.id));setResults({});setThemeId('');setError('');}}>Use all my tastes</button>}</div>
    </fieldset>
    <div className="analysis-actions">
      <button className="analysis-action" aria-pressed={Boolean(taste)} disabled={busy||Boolean(loading)||!interestIds.length} onClick={()=>void load('taste')}><Icon name="star" size={22}/><span><strong>{loading==='taste'?'Finding taste connections…':'Find a new theme from my tastes'}</strong><small>Choose a related theme to search in Discover.</small></span><Icon name="arrow" size={18}/></button>
      <button className="analysis-action" aria-pressed={Boolean(heat)} disabled={busy||Boolean(loading)||!interestIds.length} onClick={()=>void load('heatmap')}><Icon name="pin" size={22}/><span><strong>{loading==='heatmap'?'Finding a place to start…':`Start from a place in ${passport.city}`}</strong><small>See a named place from your discoveries, then search for food nearby.</small></span><Icon name="arrow" size={18}/></button>
    </div>
    {!interestIds.length&&<p role="status">Choose at least one interest to see relevant insights.</p>}
    {error&&<p role="alert">{error}</p>}
    {loading&&<p role="status">Looking for patterns in your confirmed tastes…</p>}
    {taste&&<div className="analysis-result"><span className="micro-label">THE THREADS BETWEEN YOUR FAVORITES</span><h3>Your taste themes</h3><p>Based on {passport.selected.filter(interest=>interestIds.includes(interest.id)).map(interest=>interest.name).join(" + ")}. These are cultural associations, not personality predictions.</p>
      {themes.length ? <>
        <div className="taste-theme-list" role="group" aria-label="Choose a taste theme">
          {primaryThemes.map(tag => <button key={tag.id} type="button"
            aria-pressed={themeId === tag.id} disabled={busy} onClick={() => setThemeId(tag.id)}>
            {tag.name}
          </button>)}
        </div>
        {additionalThemes.length>0 && <details className="additional-themes"><summary>See {additionalThemes.length} more returned themes</summary><div className="taste-theme-list">{additionalThemes.map(tag=><button key={tag.id} type="button" aria-pressed={themeId===tag.id} disabled={busy} onClick={()=>setThemeId(tag.id)}>{tag.name}</button>)}</div></details>}
        <div className="theme-next-step">
          <label>Explore this theme in
            <select value={effectiveThemeSection} disabled={busy} onChange={event => setThemeSection(event.target.value as Section)}>
              {themeOptions.map(section => <option key={section} value={section}>{sectionLabel(section)}</option>)}
            </select>
          </label>
          <button disabled={busy || !themeId || Boolean(loading)} onClick={exploreTheme}>
            Find {sectionLabel(effectiveThemeSection).toLowerCase()} with this theme <Icon name="arrow" size={16}/>
          </button>
        </div>
        <p className="helper">Choose a returned theme and a category. We’ll search using that theme while keeping this category’s current preferences. A theme may have no local matches.</p>
      </> : <p>No useful themes in the selected interests’ categories were returned. Try another interest or combination, or explore an area. Your discoveries are unchanged.</p>}

    </div>}
    {heat&&<div className="analysis-result area-guide"><span className="micro-label">TURN A PLACE INTO AN OUTING</span>
      <h3>Start somewhere you can actually visit</h3>
      <h4>Nearby Passport discoveries</h4>
      <p>{areas.some(area=>area.fromAreaSignal)
        ? "These are named places already in your Passport near suggested areas. Pick one as a starting point, then see food nearby."
        : "We couldn't match an area to your current places, so start with one of these existing discoveries."}</p>
      {areas.length ? <div className="area-choices">{areas.map(area=><article key={area.anchor.id}>
        <span className="micro-label">{area.fromAreaSignal ? "NEAR A TASTE-CONNECTED AREA" : "FROM YOUR DISCOVERIES"}</span>
        <h4>Start at {area.anchor.name}</h4>
        <p>{area.anchor.address || area.anchor.intelligence?.location?.address || `${sectionLabel(area.anchor.section)} in ${passport.city}`}</p>
        <p className="area-place-details">{sectionLabel(area.anchor.section)}{area.anchor.intelligence?.quality?.businessRating !== undefined ? ` · ★ ${formatReturnedRating(area.anchor.intelligence.quality.businessRating)} / 5` : ""}</p>
        {area.nearby.length > 0 && <div className="area-nearby"><strong>Also nearby</strong><ul>{area.nearby.map(place=><li key={place.id}>{place.name}<small>{sectionLabel(place.section)}</small></li>)}</ul></div>}
        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([area.anchor.name,area.anchor.address,passport.city].filter(Boolean).join(', '))}`} target="_blank" rel="noreferrer">Open this place on the map ↗</a>
        {area.point && <button disabled={busy||Boolean(loading)} onClick={()=>nearby(area.point!)}>Find food around here</button>}
      </article>)}</div> : <p>No local places are available to preview yet. Find food in Discover, then return to explore where to start.</p>}
      <p className="helper">“Find food around here” searches within 1.5 km of the named place and keeps your food preferences. Check routes and hours before going.</p>
    </div>}
  </section>;
}
