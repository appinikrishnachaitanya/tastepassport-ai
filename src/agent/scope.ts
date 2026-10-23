import type { Section } from "../passport/model.ts";
const names: [Section,RegExp][] = [
  ["Eat",/\b(?:eat|food|dining|dinner|restaurants?)\b/i], ["Coffee",/\b(?:coffee|caf[eé]s?)\b/i],
  ["Music",/\b(?:music|artists?|bands?)\b/i], ["Movies",/\b(?:movies?|films?)\b/i],
  ["Culture",/\b(?:culture|museums?|galleries|cinema|theat(?:er|re)s?|nightlife)\b/i],
  ["Lifestyle",/\b(?:lifestyle|bookstores?|shopping)\b/i], ["Books",/\bbooks?\b/i],
  ["Podcasts",/\bpodcasts?\b/i], ["Shows",/\b(?:shows?|television|tv)\b/i],
  ["Games",/\bgames?\b/i], ["Brands",/\bbrands?\b/i], ["People",/\b(?:people|actors?|authors?|directors?)\b/i],
  ["Destinations",/\b(?:destinations?|cities)\b/i],
];
/** Preservation clauses constrain execution, not just the model prompt. */
export function refinementScope(text:string) {
  const preserved=new Set<Section>();
  const capture=(clause:string)=>{for(const [section,pattern] of names)if(pattern.test(clause))preserved.add(section);return " ";};
  const positive=text
    .replace(/\b(?:keep|leave|preserve|retain)\s+[^.!?;]*?\b(?:unchanged|untouched|as[ -]is|the same|alone)\b/gi,capture)
    .replace(/\b(?:don['’]t|do not|never)\s+(?:change|update|touch|modify|refresh|refine)\s+[^.!?;]*?(?=\s+(?:but|instead|then|and\s+(?:find|show|update|refine|recommend))\b|[.!?;]|$)/gi,capture)
    .replace(/\b(?:without)\s+(?:changing|updating|touching|modifying)\s+[^.!?;]*?(?=\s+(?:but|instead|then|and\s+(?:find|show|update|refine|recommend))\b|[.!?;]|$)/gi,capture);
  return {positive,preserved:[...preserved]};
}
