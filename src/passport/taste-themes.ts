import type { Section } from "./model.ts";
import { displayTags } from "../qloo/explanation.ts";
import type { TasteTag } from "../qloo/analysis.ts";

export function themeCategories(theme:TasteTag|undefined,active:Section[]):Section[] {
  if(!theme)return active;
  const text=theme.id+' '+theme.name;
  if(/coffee|caf[eé]/i.test(text))return ['Coffee'];
  if(/:cuisine:|:specialty_dish:|:dietary_option:|:dietary_attribute:/i.test(text))return ['Eat'];
  if(/:(?:music|artist):/i.test(text))return ['Music'];
  if(/:(?:media|movie|film|tv_show):/i.test(text))return active.filter(section=>section==='Movies'||section==='Shows').length ? active.filter(section=>section==='Movies'||section==='Shows') : ['Movies'];
  if(/:(?:book|literature):/i.test(text))return ['Books'];
  if(/:ambience:|:place:/i.test(text))return active.filter(section=>['Eat','Coffee','Culture','Lifestyle'].includes(section)).length ? active.filter(section=>['Eat','Coffee','Culture','Lifestyle'].includes(section)) : ['Eat'];
  return active;
}
/** Present diverse returned families first; never synthesize cultural themes. */
export function curatedThemes(tags:TasteTag[],limit=6):TasteTag[] {
  const grouped=new Map<string,TasteTag[]>();
  for(const tag of displayTags(tags)){
    const family=tag.id.split(':').slice(2,4).join(':');
    grouped.set(family,[...(grouped.get(family)??[]),tag]);
  }
  const result:TasteTag[]=[];
  for(let rank=0;result.length<limit && [...grouped.values()].some(group=>group.length>rank);rank++)
    for(const group of grouped.values())if(group[rank]){result.push(group[rank]);if(result.length===limit)break;}
  return result;
}

/** Stay within the selected interests' returned taxonomy. Audience association
 * alone does not make an unrelated dish or venue a useful film theme. */
export function relevantThemes(tags:TasteTag[], interests:readonly {id:string;types:string[]}[]):TasteTag[] {
  const domains = new Set(interests.flatMap(interest => interest.id.startsWith('urn:tag:')
    ? [/^urn:tag:(?:cuisine|specialty_dish|dietary_option|dietary_attribute):/.test(interest.id) ? 'place' : interest.id.split(':')[3]] : interest.types.map(type=>type.replace('urn:entity:',''))));
  const allowed = new Set<string>();
  for (const domain of domains) {
    if (['movie','tv_show','media'].includes(domain)) ['media','movie','film','tv_show'].forEach(value=>allowed.add(value));
    else if (['artist','music'].includes(domain)) ['artist','music'].forEach(value=>allowed.add(value));
    else if (['book','literature'].includes(domain)) ['book','literature'].forEach(value=>allowed.add(value));
    else if (domain) allowed.add(domain);
  }
  const seen = new Set<string>();
  return displayTags(tags).filter(tag => {
    const domain = /^urn:tag:(?:cuisine|specialty_dish|dietary_option|dietary_attribute):/.test(tag.id) ? 'place' : tag.id.split(':')[3];
    const label = tag.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    if (!allowed.has(domain) || /^(?:classics?|entertainment|ambitious|indie|popular|general|other|place|restaurant|bar)$/.test(label) || seen.has(label)) return false;
    seen.add(label); return true;
  });
}
