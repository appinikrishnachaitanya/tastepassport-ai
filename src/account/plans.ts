import type { Card } from "../passport/model.ts";
import type { AgentState } from "../agent/types.ts";
import { dayOutOptions, activityMatches, outingActivities } from "../passport/day-out.ts";

export interface SavedPlan {
  id: string;
  city: string;
  scheduled_date: string;
  time_zone: string;
  stop_times: string[] | null;
  stops: Card[];
  created_at: string;
}
/** Replace the same dated outing immediately with the row returned by the write. */
export function mergeSavedPlan(current: SavedPlan[], saved: SavedPlan): SavedPlan[] {
  return [...current.filter(item => item.id !== saved.id && !(item.city === saved.city && item.scheduled_date === saved.scheduled_date)),saved];
}
/** Saved cards have a broad discovery section; recover the specific planner activity first. */
export function savedStopActivity(card: Card): typeof outingActivities[number]["id"] | undefined {
  return (["Cinema","Nightlife","Coffee","Eat","Culture"] as const).find(activity=>activityMatches(card,activity));
}
const zones: Record<string, string> = {
  Toronto: "America/Toronto",
  "New York City": "America/New_York",
  London: "Europe/London",
  Paris: "Europe/Paris",
  Tokyo: "Asia/Tokyo",
  Bengaluru: "Asia/Kolkata",
  Mumbai: "Asia/Kolkata",
  Singapore: "Asia/Singapore",
  Berlin: "Europe/Berlin",
  Sydney: "Australia/Sydney",
};
export function cityTimeZone(city: string) {
  return zones[city.split(",")[0].trim()] ?? "UTC";
}
export function cityDate(city: string, now = new Date()) {
  const zone = cityTimeZone(city);
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function nextWeekend(city: string, now = new Date()) {
  const date = new Date(`${cityDate(city, now)}T12:00:00Z`);
  const days = (6 - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + (days || 7));
  return date.toISOString().slice(0, 10);
}
/** Shared by browser download and server persistence; HTML min alone is insufficient. */
export function planDateError(city:string,value:unknown,now=new Date()):string|undefined {
  if(typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))return "Choose a valid date.";
  const parsed=new Date(`${value}T12:00:00Z`);
  if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value)return "Choose a valid date.";
  if(value<cityDate(city,now))return "Choose today or a future date in your destination.";
}
/** Client submits IDs only; names/addresses/evidence always come from trusted session state. */
export function planFromSession(state: AgentState, input: unknown, now = new Date()) {
  const b = input as { revision?: unknown; ids?: unknown; date?: unknown; stopTimes?: unknown } | null;
  if (!b || b.revision !== state.revision) throw Error("Your Passport changed. Try saving the latest plan.");
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 5 || b.ids.some((id) => typeof id !== "string") || new Set(b.ids).size !== b.ids.length)
    throw Error("Choose between one and five different stops.");
  const dateError=planDateError(state.city,b.date,now);
  if(dateError)throw Error(dateError);
  const scheduledDate=b.date as string;
  const available = dayOutOptions(state.cards.filter((c) => !state.hiddenCategories?.includes(c.section)), state.city);
  const stops = b.ids.map((id) => available.find((card) => card.id === id));
  if (stops.some((card) => !card) || new Set(stops.map(card => card && (activityMatches(card, "Cinema") ? "Cinema" : activityMatches(card, "Nightlife") ? "Nightlife" : card.section))).size !== stops.length)
    throw Error("A stop changed. Choose one current venue per activity.");
  if (!Array.isArray(b.stopTimes) || b.stopTimes.length !== stops.length || b.stopTimes.some(time => typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))
    throw Error("Choose a time for every stop.");
  const stopTimes = b.stopTimes as string[];
  if (stopTimes.some((time, index) => index > 0 && time <= stopTimes[index - 1]))
    throw Error("Put your stops in time order. Change their times or move a stop.");
  const plan = { city: state.city, scheduled_date: scheduledDate, time_zone: cityTimeZone(state.city), stop_times: stopTimes, stops: structuredClone(stops as Card[]) };
  if (new TextEncoder().encode(JSON.stringify(plan.stops)).length > 120000) throw Error("This plan is too large to save.");
  return plan;
}
export function calendarFile(plan: Pick<SavedPlan, "id" | "city" | "scheduled_date" | "time_zone" | "stop_times" | "stops">) {
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n|\r/g, "\\n").replace(/[,;]/g, (v) => `\\${v}`);
  const next = new Date(`${plan.scheduled_date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const description = [...plan.stops.map((s) => `${s.name}${s.address ? ` — ${s.address}` : ""}`), "Personal plan, not a reservation. Check opening hours and availability."].join("\n");
  const date = plan.scheduled_date.replaceAll("-", "");
  const stamp = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  const zone = /^[A-Za-z_]+(?:\/[A-Za-z_+-]+)+$/.test(plan.time_zone) ? plan.time_zone : "UTC";
  const timed = plan.stop_times?.length === plan.stops.length && plan.stop_times.every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));
  const events = timed ? plan.stops.flatMap((stop, index) => {
    const start = plan.stop_times![index];
    const [hour, minute] = start.split(":").map(Number);
    const endMinutes = Math.min(hour * 60 + minute + 60, index + 1 < plan.stop_times!.length ? Number(plan.stop_times![index + 1].slice(0, 2)) * 60 + Number(plan.stop_times![index + 1].slice(3)) : 24 * 60 - 1);
    const end = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}${String(endMinutes % 60).padStart(2, "0")}`;
    return ["BEGIN:VEVENT", `UID:${escape(plan.id)}-${index}@tastepassport`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${zone}:${date}T${start.replace(":", "")}00`, `DTEND;TZID=${zone}:${date}T${end}00`,
      `SUMMARY:${escape(stop.name)}`, `DESCRIPTION:${escape(`${stop.address ? `${stop.address}. ` : ""}Suggested start time, not a booking. Check hours and travel time.`)}`, "END:VEVENT"];
  }) : ["BEGIN:VEVENT", `UID:${escape(plan.id)}@tastepassport`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replaceAll("-", "")}`,
    `SUMMARY:${escape(`A day out in ${plan.city}`)}`, `DESCRIPTION:${escape(description)}`, "END:VEVENT"];
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TastePassport//Personal plans//EN", ...events, "END:VCALENDAR"];
  // Fold UTF-8 content lines at 75 octets, as required by iCalendar.
  return lines.map((line) => {
    let result = "", size = 0;
    for (const char of line) {
      const bytes = new TextEncoder().encode(char).length;
      if (size + bytes > 75) { result += "\r\n "; size = 1; }
      result += char; size += bytes;
    }
    return result;
  }).join("\r\n") + "\r\n";
}
