import { conversationFocus } from "./memory.ts";
import { findMentionedCard } from "./intent.ts";
import { sectionLabel } from "../passport/labels.ts";
import { categoryLanguage } from "./category-language.ts";
import { lastPresentedIds } from "./chat-shortlist.ts";
import type { Card, Section } from "../passport/model.ts";
import type { AgentState } from "./types.ts";
import { sectionOrder } from "../workspace/state.ts";
import { cardSpecificAnswer, serviceLimitationAnswer } from "./answers.ts";
import { formatReturnedRating } from "../passport/rating-display.ts";
import { priceLabel } from "../passport/pricing.ts";

/** Interpret references against currently returned, ordered Passport cards.
 * An information request never grants permission to run Qloo or change filters.
 */
export function isReadOnlyFollowUp(input: string): boolean {
  if (serviceLimitationAnswer(input)) return true;
  const q=input.trim().toLowerCase();
  // An information request cannot silently change results; equally, a real
  // refinement must not be misclassified as read-only.
  if (/\b(?:find|discover|search|update|replace|refine|remove|hide|make|change|adjust|show me more|give me more|recommend new)\b/.test(q))
    return false;
  if (/\b(?:compare|comparison|differences?|versus|vs\.?)\b/.test(q))
    return true;
  if (/^why (?:did you recommend|recommend this|the (?:first|second|third))\b/.test(q))
    return true;
  const ordinal=/(?:\b(?:first|second|third|1st|2nd|3rd)\b|#\s*[123]\b)/.test(q);
  return ordinal && /^(?:why|what|which|how|tell me|explain|is |are |does |do |can you|could you)/.test(q);
}
function categoryInText(text:string): Section|undefined {
  const t=categoryLanguage(text).toLowerCase();
  if (/\b(?:restaurants?|dining|dinner|lunch|food|eat)\b/.test(t))return "Eat";
  if (/\b(?:coffee|cafe|cafes|cafés)\b/.test(t))return "Coffee";
  if (/\b(?:movies?|films?)\b/.test(t))return "Movies";
  if (/\b(?:shows?|tv|series)\b/.test(t))return "Shows";
  if (/\b(?:culture|nightclubs?|nightlife|museums?|cinema|venues? for nightlife)\b/.test(t))return "Culture";
  if (/\bbooks?\b/.test(t))return "Books";
  if (/\bmusic\b/.test(t))return "Music";
  if (/\blifestyle|shopping|shops?\b/.test(t))return "Lifestyle";
  if (/\bpodcasts?\b/.test(t))return "Podcasts";
  return;
}
function contextSection(state: AgentState, input:string): Section|undefined {
  const explicit=categoryInText(input);
  if(explicit)return explicit;
  if (state.conversationMemory) {
    const focus = conversationFocus(state);
    return focus.length === 1 ? focus[0] : undefined;
  }
  // A list in the previous assistant turn scopes ordinal references.
  const recent=(state.history??[]).slice(-12).reverse();
  for(const entry of recent) {
    if(entry.role!=="agent")continue;
    const match=entry.text.match(/(?:Here are your \d+ current|Here are some of your|Updated)\s+(food|dining|eat|coffee(?:\s*&\s*cafés)?|culture|movies|shows|music|books|lifestyle|games|podcasts|brands|people|destinations)\s+(?:suggestions|results)/i);
    if(match) return /^(?:food|dining|eat)$/.test(match[1].toLowerCase())?"Eat":sectionOrder.find(s=>sectionLabel(s).toLowerCase()===match[1].toLowerCase() || s.toLowerCase()===match[1].toLowerCase());
  }
  const intent=state.intent?.sections?.filter(s=>state.cards.some(c=>c.section===s))??[];
  return intent.length===1?intent[0]:undefined;
}
function ordinal(text:string):number|undefined {
  const found=text.toLowerCase().match(/\b(first|second|third|1st|2nd|3rd)\b|#\s*([1-3])\b/);
  if(!found)return;
  return {first:1,second:2,third:3,"1st":1,"2nd":2,"3rd":3}[found[1] as "first"|"second"|"third"|"1st"|"2nd"|"3rd"]??Number(found[2]);
}
function compact(card:Card):string {
  const rating=formatReturnedRating(card.intelligence?.quality?.businessRating);
  const budget=priceLabel(card.intelligence?.commercial?.priceLevel);
  return `${card.name}${card.address?` — ${card.address}`:""}${rating!==undefined?` · ★ ${rating}/5 (Qloo-reported)`:" · Business rating unavailable"}${budget?` · Typical price: ${budget} (${card.intelligence?.commercial?.priceLevel}/4)`:" · Price category unavailable"}`;
}
export function readOnlyFollowUp(state:AgentState,query:string):string {
  const limitation = serviceLimitationAnswer(query);
  if (limitation) return limitation;
  const presented=lastPresentedIds(state);
  const requestedIndex=ordinal(query);
  const comparing=/\b(?:compare|comparison|differences?|versus|vs\.?)\b/i.test(query);
  if(presented.length && requestedIndex && !categoryInText(query) && !comparing) {
    const id=presented[requestedIndex-1];
    const card=state.cards.find(card=>card.id===id && !state.hiddenCategories?.includes(card.section));
    if(!card)return "That choice is no longer in your current discoveries. Ask for a new shortlist; I haven’t changed your Passport.";
    if(/\b(?:rating|rated|stars?)\b/i.test(query)) {
      const rating=formatReturnedRating(card.intelligence?.quality?.businessRating ?? card.intelligence?.quality?.qlooRating);
      return rating ? `${card.name} has a returned ${card.intelligence?.quality?.businessRating!==undefined?"business ":""}rating of ${rating}/5. Your Passport is unchanged.` : `A rating wasn’t returned for ${card.name}. Your Passport is unchanged.`;
    }
    return cardSpecificAnswer(card,query);
  }
  if(comparing && !categoryInText(query) && presented.some(id=>!state.cards.some(card=>card.id===id && !state.hiddenCategories?.includes(card.section))))
    return "One of those choices is no longer in your current discoveries. Ask for a new shortlist before comparing. Your Passport is unchanged.";
  const focused=presented.flatMap(id=>state.cards.find(card=>card.id===id) ?? []);
  const explicitlyNamed = findMentionedCard(query, state.cards.filter(card => !state.hiddenCategories?.includes(card.section)));
  const section=explicitlyNamed?.section ?? contextSection(state,query);

  const cards=comparing && focused.length && !categoryInText(query) ? focused : section?state.cards.filter(c=>c.section===section && !(state.hiddenCategories??[]).includes(c.section)):[];
  if(!section && !(comparing && focused.length))
    return "Which category should I use—Food, Coffee & cafés, Culture or another chapter? I haven't changed your Passport.";
  if(!cards.length)
    return `There aren't current ${section ? sectionLabel(section) : "Passport"} recommendations to explain. I haven't changed anything.`;
  const isCompare=/\b(?:compare|comparison|differences?|versus|vs\.?|which (?:one|of (?:these|the two)))\b/i.test(query);
  const index=ordinal(query);
  const named=cards.find(c=>query.toLowerCase().includes(c.name.toLowerCase()));
  const lastNamed=(state.history??[]).slice(-8).reverse().find(row=>row.role==="user" && cards.some(card=>row.text.toLowerCase().includes(card.name.toLowerCase())));
  const remembered=lastNamed?cards.find(c=>lastNamed.text.toLowerCase().includes(c.name.toLowerCase())):undefined;
  const list = cards.slice(0,3).map((c,i)=>`${i+1}. ${c.name}`).join("\n");
  if(isCompare){
    const explicitOrdinals=[...query.matchAll(/\b(first|second|third|1st|2nd|3rd)\b/gi)].map(m=>ordinal(m[0])).filter((n):n is number=>n!==undefined);
    const targets=explicitOrdinals.length>=2?[cards[explicitOrdinals[0]-1],cards[explicitOrdinals[1]-1]]:cards.slice(0,2);
    if(targets.length<2 || !targets[0] || !targets[1])
      return `I need two current ${section ?? "Passport"} results to compare. Here's what I have:\n${list}\nYour Passport is unchanged.`;
    const [a,b]=targets;
    const ra=a.intelligence?.quality?.businessRating,rb=b.intelligence?.quality?.businessRating;
    const pa=a.intelligence?.commercial?.priceLevel,pb=b.intelligence?.commercial?.priceLevel;
    const differences:string[]=[];
    if(ra!==undefined&&rb!==undefined && ra!==rb)differences.push(`${ra>rb?a.name:b.name} has the higher Qloo-reported business rating; that doesn't prove it suits your tastes better.`);
    if(pa!==undefined&&pb!==undefined&&pa!==pb)differences.push(`${pa<pb?a.name:b.name} has the lower returned typical price category.`);
    if(!differences.length)differences.push("The returned ratings and prices don't establish a clear winner. Consider location and the atmosphere you're looking for.");
    return `Here's a comparison of two existing ${section ? sectionLabel(section) : "Passport"} options:\n\n1. ${compact(a)}\n2. ${compact(b)}\n\n${differences.join(" ")} Qloo's taste associations don't verify current noise, hours, availability or exact prices. Tell me which matters more and I'll help you choose. Your Passport is unchanged.`;
  }
  const card=index!==undefined?cards[index-1]:named??remembered;
  if(!card)
    return `Which ${section==="Eat"?"restaurant":(section?.toLowerCase() ?? "Passport")+" result"} do you mean? Here are the first choices:\n${list}\n\nYou can say "the second one" or name it. Your Passport is unchanged.`;
  if(/\b(?:rating|rated|stars?)\b/i.test(query)){
    const rating=formatReturnedRating(card.intelligence?.quality?.businessRating);
    return rating!==undefined?`${card.name} has a Qloo-reported business rating of ${rating}/5. That is separate from its cultural taste affinity. Your Passport is unchanged.`
      :`A verified business rating isn't available for ${card.name} in the returned data. Your Passport is unchanged.`;
  }
  if(/\b(?:how much|price|cost|cheaper|expensive)\b/i.test(query)){
    const budget=priceLabel(card.intelligence?.commercial?.priceLevel);
    return budget?`${card.name} has a returned typical price category of ${budget} (${card.intelligence?.commercial?.priceLevel}/4). This isn't a current menu price or quote. Your Passport is unchanged.`:
      `I don't have a verified price category for ${card.name}. Check current prices with the venue. Your Passport is unchanged.`;
  }
  return cardSpecificAnswer(card,query);
}
