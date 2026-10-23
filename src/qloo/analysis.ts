import { request } from './client.ts';
import { isObject } from './types.ts';
export type AnalysisKind = 'taste' | 'heatmap' | 'demographics';
export interface TasteTag { id: string; name: string; affinity?: number }
export interface HeatPoint { latitude: number; longitude: number; affinity: number; popularity?: number }
export interface DemographicRecord { id: string; age: Record<string, number>; gender: Record<string, number> }
export type AnalysisResult =
  | { kind:'taste'; tags:TasteTag[]; recordedAt:string }
  | { kind:'heatmap'; points:HeatPoint[]; recordedAt:string }
  | { kind:'demographics'; records:DemographicRecord[]; recordedAt:string };
const finite = (v:unknown):v is number => typeof v === 'number' && Number.isFinite(v);
/** Never trust arbitrary client IDs: analysis uses only confirmed interests in this session. */
export function selectAnalysisSignals(selected: readonly {id:string}[], ids:unknown) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 5 || ids.some(id=>typeof id !== 'string') || new Set(ids).size !== ids.length)
    throw Error('Select one to five different confirmed interests.');
  const known = new Set(selected.map(t=>t.id));
  if (ids.some(id=>!known.has(id))) throw Error('Choose only interests confirmed in your Passport.');
  return {
    entities: ids.filter((id:string)=>!id.startsWith('urn:tag:')) as string[],
    tags: ids.filter((id:string)=>id.startsWith('urn:tag:')) as string[],
  };
}
/** Qloo can return the same theme with different identifiers or label variants. */
function distinctTasteTags(tags:TasteTag[]):TasteTag[] {
  const seen=new Set<string>();
  return [...tags].sort((a,b)=>(b.affinity??-1)-(a.affinity??-1)).filter(tag=>{
    const key=tag.name.toLowerCase().replace(/\b(?:cuisine|food|style)\b/g,'').replace(/[^\p{L}\p{N}]/gu,'');
    if(!key || seen.has(key))return false;
    seen.add(key);return true;
  });
}

/** Special Insights collections have their own schemas, never entity parsers. */
export function parseAnalysis(kind:AnalysisKind, body:unknown):AnalysisResult {
  if (!isObject(body) || body.success === false || !isObject(body.results)) throw Error('Unexpected analysis response');
  const recordedAt=new Date().toISOString(), results=body.results;
  const field=kind==='taste' ? 'tags' : kind==='heatmap' ? 'heatmap' : 'demographics';
  if (!Array.isArray(results[field])) throw Error('Unexpected analysis collection');
  const rows=results[field].filter(isObject);
  if(kind==='taste') return {kind,recordedAt,tags:distinctTasteTags(rows.flatMap(t=>{
    if(typeof t.tag_id!=='string' || !/^urn:tag:[\w:-]+$/.test(t.tag_id) || typeof t.name!=='string')return [];
    const q=isObject(t.query)?t.query:{};
    return [{id:t.tag_id,name:t.name.slice(0,180),...(finite(q.affinity)?{affinity:q.affinity}:{})}];
  })).slice(0,12)};
  if(kind==='heatmap') return {kind,recordedAt,points:rows.flatMap(t=>{
    const p=isObject(t.location)?t.location:{},q=isObject(t.query)?t.query:{};
    if(!finite(p.latitude)||Math.abs(p.latitude)>90||!finite(p.longitude)||Math.abs(p.longitude)>180||!finite(q.affinity))return [];
    return [{latitude:p.latitude,longitude:p.longitude,affinity:q.affinity,...(finite(q.popularity)?{popularity:q.popularity}:{})}];
  }).slice(0,2000)};
  const metrics=(v:unknown)=>Object.fromEntries(Object.entries(isObject(v)?v:{}).filter((pair):pair is [string,number]=>finite(pair[1])));
  return {kind,recordedAt,records:rows.flatMap(t=>{
    if(typeof t.entity_id!=='string')return [];
    const q=isObject(t.query)?t.query:{};
    return [{id:t.entity_id,age:metrics(q.age),gender:metrics(q.gender)}];
  }).slice(0,10)};
}
export async function analyze(kind:AnalysisKind, interests:{entities:string[];tags:string[]},city:string,signal?:AbortSignal) {
  if(!['taste','heatmap','demographics'].includes(kind))throw Error('Invalid analysis type');
  if(!interests.entities.length&&!interests.tags.length)throw Error('Confirmed interests are required');
  if(interests.entities.some(id=>!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) || interests.tags.some(id=>!/^urn:tag:[\w:-]+$/.test(id)))throw Error('Invalid analysis signals');
  const params:Record<string,string>={'filter.type':kind==='taste'?'urn:tag':kind==='heatmap'?'urn:heatmap':'urn:demographics'};
  if(interests.entities.length)params['signal.interests.entities']=interests.entities.slice(0,10).join(',');
  if(interests.tags.length)params['signal.interests.tags']=interests.tags.slice(0,10).join(',');
  if(kind==='heatmap')params['filter.location.query']=city;
  else if(kind==='taste'){params.take='12';params['diversify.by']='subtype';params['diversify.take']='3';}
  return parseAnalysis(kind,await request('/v2/insights/',params,signal));
}
