import { readTasteProfile, type TasteProfile } from "./taste-profile.ts";
export function profileName(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\p{Cc}<>]/u.test(value))
    throw Error("Use a profile name of 1–80 characters.");
  return value.trim();
}
export function validProfileId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}
export interface SavedTasteProfile { id: string; name: string; updated_at: string; profile: TasteProfile }
export function exportTasteProfile(row: SavedTasteProfile) {
  return { schema: "tastepassport.profile", version: 1, name: row.name, updatedAt: row.updated_at, preferences: readTasteProfile(row.profile) };
}
