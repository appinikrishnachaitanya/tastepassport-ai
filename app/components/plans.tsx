"use client";
import { calendarFile, cityDate, savedStopActivity, type SavedPlan } from "../../src/account/plans";
import { outingActivities } from "../../src/passport/day-out";

export function downloadCalendar(plan: SavedPlan) {
  const url = URL.createObjectURL(new Blob([calendarFile(plan)], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "tastepassport-plan.ics"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function UpcomingPlans({ plans, busy, error, editableCity, onEdit, onDelete, onRetry }: {
  plans: SavedPlan[]; busy: boolean; error: string;
  editableCity?:string; onEdit?:(plan:SavedPlan)=>void;
  onDelete: (id: string) => void; onRetry: () => void;
}) {
  const upcoming = plans.filter((p) => p.scheduled_date >= cityDate(p.city))
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || (a.stop_times?.[0] ?? "").localeCompare(b.stop_times?.[0] ?? ""));
  return <section className="upcoming-plans" aria-label="Your upcoming plans">
    <p className="helper">Your own outings, saved by date and suggested local time. Check opening hours and travel before going; these are not bookings.</p>
    {error ? <div role="alert"><p>{error}</p><button className="quiet-button" disabled={busy} onClick={onRetry}>Try again</button></div>
      : !upcoming.length ? <div className="library-empty"><h3>Your next good day starts here.</h3><p>Build a Passport, open Plan a day out, choose a date, and save your stops.</p></div>
      : upcoming.map((plan) => <article className="saved-plan" key={plan.id}>
        <div className="plan-date"><span>{new Date(`${plan.scheduled_date}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })}</span><strong>{plan.scheduled_date.slice(-2)}</strong></div>
        <div className="plan-details"><h3>A day out in {plan.city}</h3>
          <p>{new Date(`${plan.scheduled_date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })} · {plan.time_zone === "UTC" ? "UTC" : `Local time in ${plan.city}`}</p>
          <ol>{plan.stops.map((stop,index) => <li key={stop.id}><strong>{plan.stop_times?.[index] ? `${plan.stop_times[index]} · ` : ""}{stop.name}</strong><span>{outingActivities.find(activity=>activity.id===savedStopActivity(stop))?.label??stop.section}{stop.address ? ` · ${stop.address}` : ""}</span></li>)}</ol>
          <div className="plan-actions">{onEdit&&editableCity===plan.city&&<button className="quiet-button" disabled={busy} onClick={()=>onEdit(plan)}>Edit</button>}<button className="quiet-button" onClick={() => downloadCalendar(plan)}>Add to calendar</button>
            <button className="text-button" disabled={busy} onClick={() => onDelete(plan.id)}>Delete plan</button></div>
        </div>
      </article>)}
  </section>;
}
