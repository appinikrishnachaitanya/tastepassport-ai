import { categoryLanguage } from "./category-language.ts";
import type { Intent } from "./types.ts";

/** A discovery goal is a search mode, not a cultural taxonomy tag. */
export function isDiscoveryGoalConcept(value: string): boolean {
  return /^(?:(?:hidden[-\s]?gems?|trending|popular|safe[-\s]?bets?|surprise(?:[-\s]?me)?|discover(?:y)?)\s*)+$/i.test(value.trim());
}
function words(value: string): string[] {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
}
/** Model ideas may help classify an explicit request but may not manufacture a
 * blocking Qloo concept unrelated to that request. */
export function groundedModelIntent(request: string, model: Intent, explicit: Intent): Intent {
  const currentRequest = categoryLanguage(request).replace(
    /\b(?:i\s+)?(?:don['’]t|do not|no longer)\s+need\s+[^.!?;]*?(?=\b(?:all i want|instead|just|but)\b|[.!?;]|$)/gi, " ");
  const spoken = new Set(words(currentRequest));
  const explicitConcepts = new Set(explicit.concepts.map(x=>words(x).join(" ")));
  const grounded = (concept: string) => {
    if (isDiscoveryGoalConcept(concept)) return false;
    if (explicitConcepts.has(words(concept).join(" "))) return true;
    const meaningful = words(concept).filter(x=>![
      "cuisine","restaurant","restaurants","place","places","venue","venues",
      "food","foods","dining","type","category","genre","interest","interests","qloo"
    ].includes(x));
    // The model may normalize requested nouns ("sushi" -> "sushi cuisine"),
    // but cannot introduce concepts the user never mentioned.
    return meaningful.length>0 && meaningful.every(x=>spoken.has(x));
  };
  const concepts = [...new Set([...explicit.concepts,...model.concepts.filter(grounded)])].slice(0,5);
  const excludeConcepts = [...new Set([
    ...(explicit.excludeConcepts ?? []),
    ...(model.excludeConcepts ?? []).filter(grounded),
  ])].slice(0,5);
  // Conversation history supplies references, never authorization for a new edit.
  // If neither the current message nor grounded concepts identify an action,
  // a model-generated category/filter guess must become a clarification.
  if ((model.kind === "refine" || model.kind === "hide") && explicit.kind === "unknown" && !explicit.question && !explicit.sections.length &&
      !explicit.concepts.length && !explicit.constraints.length && !Object.keys(explicit.query ?? {}).length &&
      !concepts.length && !excludeConcepts.length &&
      !(/\b(?:raise|lower|increase|decrease|set)\b/i.test(request) && /\d/.test(request))) return {...explicit};
  const query = model.query ? {...model.query} : undefined;
  // A hidden-gems/trending search request is a goal, not a requirement to
  // choose between homonymous taxonomy tags. No goal carries over to greetings.
  if (query?.goal && !explicit.query?.goal) delete query.goal;
  if (explicit.query?.goal) {
    if (query) query.goal=explicit.query.goal;
    else return {...model,concepts,excludeConcepts,query:{goal:explicit.query.goal}};
  }
  return {...model,concepts,excludeConcepts, ...(query?{query}:{})};
}
export function isGreetingOrTypo(text: string): boolean {
  return /^(?:h[iyj]|he(?:llo|lli|llo+|ya|y)|hello|hi|hey|hiya)(?:\s+bro)?[!,.?\s]*$/i.test(text.trim());
}
