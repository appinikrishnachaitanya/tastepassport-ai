"use client";
import { Icon } from "./passport";
import { useState, useEffect } from "react";
import type { Card } from "../../src/passport/model";
import type { Passport } from "../../src/workspace/state";
import {
  dayOutOptions,
  dayOutText,
  stopDistance,
  nearbyOutingOptions,
  outingActivities,
  activityMatches,
} from "../../src/passport/day-out";
import { evidenceFacts } from "../../src/qloo/explanation";
import { cityDate, cityTimeZone, nextWeekend, planDateError, savedStopActivity, type SavedPlan } from "../../src/account/plans";
import { accountRequest, showNotice } from "../../src/account/browser";

export default function DayOutPlan({
  passport,
  disabled,
  signedIn = false,
  expanded,
  editPlan,
  onFindActivity,
}: {
  passport: Passport;
  disabled: boolean;
  signedIn?: boolean;
  expanded?: boolean;
  editPlan?: {plan:SavedPlan;nonce:number};
  onFindActivity?: (id:string)=>void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [omitted, setOmitted] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("");
  const [date, setDate] = useState(() => cityDate(passport.city));
  const [stopTimes, setStopTimes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const requestOrder = passport.session?.outingActivities?.filter(id=>outingActivities.some(a=>a.id===id));
  const [activities, setActivities] = useState<string[]>(()=>requestOrder?.length ? requestOrder : ["Coffee","Culture","Eat"].filter(id=>dayOutOptions(passport.cards,passport.city).some(c=>activityMatches(c,id))));
  const orderKey=requestOrder?.join(',') ?? '';
  useEffect(()=>{if(orderKey)setActivities(orderKey.split(','));},[orderKey]);
  const options = dayOutOptions(passport.cards, passport.city);
  useEffect(()=>{
    if(!editPlan || editPlan.plan.city!==passport.city)return;
    const plan=editPlan.plan;
    const pairs=plan.stops.map((card,index)=>({
      activity:savedStopActivity(card),
      card,time:plan.stop_times?.[index],
    })).filter((row):row is typeof row & {activity:typeof outingActivities[number]["id"]}=>Boolean(row.activity));
    const activities=[...new Set(pairs.map(row=>row.activity))];
    const available=new Set(options.map(card=>card.id));
    setActivities(activities);
    setDate(plan.scheduled_date);
    setChoices(Object.fromEntries(pairs.filter(row=>available.has(row.card.id)).map(row=>[row.activity,row.card.id])));
    setOmitted(Object.fromEntries(pairs.filter(row=>!available.has(row.card.id)).map(row=>[row.activity,true])));
    setStopTimes(Object.fromEntries(pairs.filter(row=>row.time).map(row=>[row.activity,row.time!])));
    setStatus(pairs.some(row=>!available.has(row.card.id))
      ? "Your saved plan is open. Some places are no longer in this Passport; choose current discoveries before updating it."
      : "Your saved plan is open. Change its stops or times, then update it for this date.");
  },[editPlan?.nonce]);
  const editingSameDate=editPlan?.plan.city===passport.city && editPlan.plan.scheduled_date===date;
  let previousStop:Card | undefined;
  const stops = activities.map(id => ({ ...outingActivities.find(a => a.id === id)!, id })).map((stop) => {
    const pool = nearbyOutingOptions(options.filter((card) => activityMatches(card, stop.id)),previousStop);
    // A choice removed by refinement requires explicit reselection.
    const selected = choices[stop.id]
      ? pool.find((card) => card.id === choices[stop.id])
      : pool[0];
    const chosen=omitted[stop.id] ? undefined : selected;
    const distance=previousStop && chosen ? stopDistance(previousStop,chosen) : undefined;
    if(chosen)previousStop=chosen;
    return {...stop,pool,selected:chosen,distance};
  });
  // Pin every displayed default; sequence changes must never choose new venues.
  const displayedKey = stops.map(stop => `${stop.id}:${stop.selected?.id ?? ""}`).join("|");
  useEffect(() => {
    setChoices(current => {
      const next = {...current};
      let changed = false;
      for (const stop of stops) if (stop.selected && current[stop.id] === undefined) {
        next[stop.id] = stop.selected.id;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [displayedKey]);
  const selected = stops.flatMap((stop) =>
    stop.selected ? [stop.selected] : [],
  );
  const duplicateStops = new Set(selected.map(card => card.id)).size !== selected.length;
  const timeFor = (id: string, index: number) => stopTimes[id] ?? `${String(11 + Math.floor(index * 90 / 60)).padStart(2, "0")}:${String(index * 90 % 60).padStart(2, "0")}`;
  const selectedStops = stops.filter(stop => Boolean(stop.selected));
  const timesInOrder = selectedStops.every((stop, index) => index === 0 || timeFor(selectedStops[index - 1].id, stops.indexOf(selectedStops[index - 1])) < timeFor(stop.id, stops.indexOf(stop)));

  function moveActivity(id: string, direction: -1 | 1) {
    setActivities(current => {
      const index = current.indexOf(id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  function reselectNearby() {
    const next: Record<string,string> = {};
    let previous: Card | undefined;
    for (const id of activities) {
      if (omitted[id]) continue;
      const chosen = nearbyOutingOptions(options.filter(card=>activityMatches(card,id)),previous)[0];
      if (chosen) { next[id]=chosen.id; previous=chosen; }
    }
    setChoices(next);
    setStatus("Venues reselected for this order from your current discoveries. Check travel times and availability.");
  }

  const dateError=planDateError(passport.city,date);
  function exportError():string|undefined {
    return planDateError(passport.city,date) ?? (!timesInOrder ? "Put your stops in time order." : duplicateStops ? "Choose different venues for each activity." : !selected.length ? "Choose at least one stop." : undefined);
  }
  function download() {
    const error=exportError();
    if(error){setStatus(error);showNotice(error,"error");return;}
    const itinerary=stops.map((stop,index)=>({activity:stop.id as typeof outingActivities[number]["id"],time:timeFor(stop.id,index),card:stop.selected}));
    const blob = new Blob([dayOutText(passport.city,itinerary,date,cityTimeZone(passport.city))], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tastepassport-day-out.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const message=selected.length === activities.length ? "Your plan is downloaded." : "Your partial plan is downloaded, including stops that still need a place.";
    setStatus(message);
    showNotice(message);
  }
  async function savePlan() {
    const error=exportError();
    if(error){setStatus(error);showNotice(error,"error");return;}
    if (!signedIn) {
      setStatus(
        "Sign in to save this plan. Your chosen date and stops will stay here.",
      );
      window.dispatchEvent(new Event("tastepassport:open-account"));
      return;
    }
    if (!passport.agent) return;
    setSaving(true);
    try {
      const saved = await accountRequest("/api/account/plans", {
        sessionId: passport.agent.sessionId,
        revision: passport.agent.revision,
        ids: selected.map((s) => s.id),
        stopTimes: selectedStops.map(stop => timeFor(stop.id, stops.indexOf(stop))),
        date,
      });
      setStatus(
        "Saved! Open My plans & Passports in the navigation, then choose Upcoming plans.",
      );
      showNotice(editingSameDate ? "Your saved plan was updated." : "Your plan is saved to Upcoming plans.");
      window.dispatchEvent(new CustomEvent<{plan:SavedPlan}>("tastepassport:plans-updated",{detail:{plan:saved.plan}}));
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Could not save your plan.";
      setStatus(text);
      showNotice(text, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="secondary-reveal day-out-reveal" open={expanded}>
      <summary>Plan a day out in {passport.city}</summary>
      <div className="day-out-plan">
        <header className="outing-intro"><span className="outing-emblem" aria-hidden="true"><Icon name="pin" size={28}/></span><div><span className="micro-label">A LITTLE TASTE. A WHOLE DAY OUT.</span>
        <h2>Make a day of it.</h2><p>Your places, your pace. Bring a few favorites together into a plan.</p></div></header>
        <div className="outing-progress" aria-label="Your plan at a glance"><span><Icon name="pin" size={16}/>{passport.city}</span><span>{selected.length}/{activities.length} stops chosen</span><span>{date ? new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined,{month:"short",day:"numeric",timeZone:"UTC"}) : "Choose a date"}</span></div>
        {selected.length < activities.length && <p role="status">{activities.length-selected.length} stops still need a place. Choose an option below, or leave them open.</p>}
        <p>Swap a stop or change the order. Your selected venues stay put.</p>
        <div className="plan-schedule">
          <label htmlFor="plan-date">
            When are you going?
            <input
              id="plan-date"
              type="date"
              min={cityDate(passport.city)}
              value={date}
              disabled={disabled || saving}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>

          <button
            className="quiet-button"
            type="button"
            disabled={disabled || saving}
            onClick={() => {
              const weekend = nextWeekend(passport.city);
              setDate(weekend);
              setStatus(
                `Your plan is set for ${new Date(`${weekend}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}.`,
              );
            }}
          >
            Next weekend
          </button>
          <span className="plan-zone">{cityTimeZone(passport.city) === "UTC" ? "Times shown in UTC" : `Local time in ${passport.city}`}</span>
        </div>
        <fieldset className="outing-activities"><legend>What would you like to do?</legend>
          {outingActivities.map(activity => <label key={activity.id}><input type="checkbox" checked={activities.includes(activity.id)} disabled={disabled || saving} onChange={e => {setActivities(old => e.target.checked ? [...old, activity.id] : old.filter(id => id !== activity.id)); if(e.target.checked && !options.some(card=>activityMatches(card,activity.id))) onFindActivity?.(activity.id);}} />{activity.label}</label>)}
        </fieldset>
        <ol className="day-out-stops">
          {stops.map((stop, index) => (
            <li key={stop.id}>
              <div className="stop-heading"><span className="stop-number">{String(index+1).padStart(2,"0")}</span><div><span className="micro-label">{stop.label}</span><h3>{stop.selected?.name ?? `Choose your ${stop.label.toLowerCase()} stop`}</h3></div><Icon name={stop.section} size={22}/></div>
              <label className="stop-time-label">Start time
                <input type="time" value={timeFor(stop.id,index)} disabled={disabled || saving} onChange={event=>setStopTimes(old=>({...old,[stop.id]:event.target.value}))}/>
              </label>
              <div className="outing-order">
                <button type="button" className="quiet-button"
                  disabled={disabled || saving || index === 0}
                  aria-label={`Move ${stop.label} earlier`}
                  onClick={() => moveActivity(stop.id, -1)}>↑ Earlier</button>
                <button type="button" className="quiet-button"
                  disabled={disabled || saving || index === stops.length - 1}
                  aria-label={`Move ${stop.label} later`}
                  onClick={() => moveActivity(stop.id, 1)}>↓ Later</button>
              </div>
              <label htmlFor={`day-out-${stop.id}`}>{stop.label}</label>
              <select
                id={`day-out-${stop.id}`}
                disabled={disabled || saving || !stop.pool.length}
                value={stop.selected?.id ?? ""}
                onChange={(event) => {
                  const id = event.target.value;
                  setChoices((old) => ({ ...old, [stop.id]: id }));
                  setOmitted((old) => ({ ...old, [stop.id]: !id }));
                  setStatus(
                    `${stop.section} updated. Your other choices stay the same.`,
                  );
                }}
              >
                <option value="">
                  {stop.pool.length ? "Leave this stop open" : "No matches yet"}
                </option>
                {stop.pool.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.name}
                  </option>
                ))}
              </select>
              {!stop.pool.length && (
                <p className="helper">
                  No local suggestions here yet. Try adjusting this category, or
                  leave the stop open.
                  {onFindActivity && <button type="button" className="quiet-button" disabled={disabled||saving} onClick={()=>onFindActivity(stop.id)}>Find {stop.label.toLowerCase()} options</button>}
                </p>
              )}
              {stop.distance !== undefined && <p className="helper">{stop.distance.toFixed(1)} km straight-line from the previous stop. Check transport and travel time.</p>}
              {stop.selected && (
                <>
                  <p>
                    {stop.selected.address ||
                      "Address not provided in this discovery."}
                  </p>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      [stop.selected.name, stop.selected.address, passport.city]
                        .filter(Boolean)
                        .join(", "),
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Look up location &amp; hours ↗
                  </a>
                  <details>
                    <summary>Why this stop?</summary>
                    {evidenceFacts(stop.selected).slice(0,4).map(fact => <p key={fact}>{fact}</p>)}
                    <small>Suggested for your confirmed interests.</small>
                  </details>
                </>
              )}
              {!stop.selected && stop.pool.length > 0 && (
                <p className="helper">
                  Choose a discovery above, or keep this stop open. A previous
                  choice may have changed after refinement.
                </p>
              )}
            </li>
          ))}
        </ol>
        {!timesInOrder && <p role="alert">Your stop times need to follow the order above. Adjust a time or move a stop.</p>}
        <button type="button" className="quiet-button" disabled={disabled || !options.length} onClick={reselectNearby}>Reselect venues for this order</button>
        {selected.some(
          (card, index) =>
            index > 0 && (stopDistance(selected[index - 1], card) ?? 0) > 15,
        ) && (
          <p role="status">
            Some stops are more than 15 km apart in a straight line. Consider a
            closer choice and check transport before going.
          </p>
        )}
        <details className="outing-checklist"><summary>Before you go</summary><p>Your chosen times are suggestions, not verified opening hours or reservations. Check hours, travel times, current prices and availability. Saving again for the same city and date updates that plan.</p></details>
        {dateError && <p role="alert">{dateError}</p>}
        <div className="plan-save-actions">
          {duplicateStops && <p role="alert">Choose different venues for each activity, or leave a repeated stop open.</p>}
          <button
            className="quiet-button download-plan"
            onClick={download}
            disabled={disabled || !selected.length || duplicateStops || Boolean(dateError) || !timesInOrder}
          >
            {selected.length === activities.length
              ? "Download my plan"
              : "Download partial plan"}
          </button>
          <button
            className="primary-button"
            disabled={disabled || saving || !selected.length || !date || Boolean(dateError) || duplicateStops || !timesInOrder}
            onClick={() => void savePlan()}
          >
            {saving
              ? "Saving your plan…"
              : signedIn
                ? editingSameDate ? "Update saved plan" : "Save to Upcoming plans"
                : "Sign in to save plan"}
          </button>
        </div>
        <p role="status">{status}</p>
      </div>
    </details>
  );
}
