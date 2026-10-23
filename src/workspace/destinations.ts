import "server-only";
import { createClient } from "@supabase/supabase-js";
import { destinations } from "./state";
import { validDestination } from "./location";

/** Public catalogue only: never use the service role for discovery metadata. */
export async function destinationCatalog(): Promise<string[]> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY)
    return [...destinations];
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(8000) }) },
  });
  const { data, error } = await client.from("destinations").select("name").eq("enabled", true).order("sort_order").order("name");
  if (error) throw Error("Destinations could not load. Check the destination migration and try again.");
  return data.map(row => row.name).filter((name): name is string => typeof name === "string" && validDestination(name));
}
export async function catalogCity(value: unknown): Promise<string | undefined> {
  if (typeof value !== "string" || !validDestination(value)) return;
  const name = value.trim().toLowerCase();
  const canonical = name === "nyc" || name === "new york" ? "new york city" : name === "bangalore" ? "bengaluru" : name;
  return (await destinationCatalog()).find(city => city.toLowerCase() === canonical);
}
