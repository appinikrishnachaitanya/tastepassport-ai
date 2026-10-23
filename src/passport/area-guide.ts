import { isPlaceSection, type Card } from "./model.ts";
import type { HeatPoint } from "../qloo/analysis.ts";

export interface AreaGuide {
  anchor: Card;
  point?: {latitude:number;longitude:number};
  nearby: Card[];
  /** Geo proximity only, never proof the named venue shares audience affinity. */
  fromAreaSignal: boolean;
}
function point(card: Card) {
  const location=card.intelligence?.location;
  return location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
    ? {latitude:location.latitude!,longitude:location.longitude!} : undefined;
}
function distance(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}) {
  const radians=Math.PI/180;
  const deltaLat=(b.latitude-a.latitude)*radians,deltaLon=(b.longitude-a.longitude)*radians;
  const h=Math.sin(deltaLat/2)**2+Math.cos(a.latitude*radians)*Math.cos(b.latitude*radians)*Math.sin(deltaLon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
/** Reuse already returned venues. No geocoder, extra provider call or invented neighbourhood. */
export function buildAreaGuide(points:HeatPoint[],cards:Card[]):AreaGuide[] {
  const places=cards.filter(card=>isPlaceSection(card.section));
  const ranked=places.map((anchor,index)=>{
    const location=point(anchor);
    const matching=location ? points.filter(candidate=>distance(location,candidate)<=1500) : [];
    return {anchor,point:location,index,signal:matching.length ? Math.max(...matching.map(candidate=>candidate.affinity)) : undefined};
  });
  // A venue near an affinity point is only geographically adjacent, not
  // independently established to share an audience or personal preference.
  const connected=ranked.filter(row=>row.signal!==undefined).sort((a,b)=>b.signal!-a.signal! || a.index-b.index);
  const candidates=connected.length ? connected : ranked;
  const chosen:AreaGuide[]=[];
  for(const row of candidates) {
    if(chosen.some(existing=>existing.anchor.name.toLowerCase()===row.anchor.name.toLowerCase() || (existing.point && row.point && distance(existing.point,row.point)<1500)))continue;
    const nearby=row.point ? places.filter(card=>card.id!==row.anchor.id && point(card) && distance(row.point!,point(card)!)<=1500).slice(0,2) : [];
    chosen.push({anchor:row.anchor,point:row.point,nearby,fromAreaSignal:row.signal!==undefined});
    if(chosen.length===3)break;
  }
  return chosen;
}
