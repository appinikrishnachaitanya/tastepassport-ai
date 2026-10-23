import type { Passport } from "./state.ts";

/** Best-effort per-tab recovery of the last SUCCESSFULLY RENDERED guest Passport.
 * No account credentials or server secrets are stored. Does not create a new
 * server session or claim that a lost/expired session can still be edited.
 */
const KEY="tastepassport.guest.recovery.v1";
const MAX_BYTES=1_800_000;
const LIFETIME_MS=2*60*60_000;
interface StorageLike {
  getItem(key:string):string|null;
  setItem(key:string,value:string):void;
  removeItem(key:string):void;
}
function safePassport(value:unknown):value is Passport {
  if(!value || typeof value!=="object")return false;
  const p=value as Passport;
  return typeof p.city==="string" && p.city.length>0 &&
    Array.isArray(p.selected) && Array.isArray(p.cards) && Array.isArray(p.notices) &&
    typeof p.agent?.sessionId==="string" && typeof p.agent.revision==="number" &&
    p.session?.id===p.agent.sessionId &&
    p.session?.revision===p.agent.revision &&
    Array.isArray(p.session?.cards) &&
    p.cards.every(c=>typeof c?.id==="string" && typeof c?.section==="string" && typeof c?.name==="string");
}
export function rememberGuestPassport(store:StorageLike,passport:Passport,now=Date.now()):boolean {
  try {
    if(!safePassport(passport))return false;
    const json=JSON.stringify({version:1,savedAt:now,expiresAt:now+LIFETIME_MS,passport});
    if(json.length>MAX_BYTES)return false;
    store.setItem(KEY,json);
    return true;
  }catch{return false;}
}
export function restoreGuestPassport(store:StorageLike,now=Date.now()):Passport|undefined {
  try{
    const raw=store.getItem(KEY);
    if(!raw)return;
    if(raw.length>MAX_BYTES){store.removeItem(KEY);return;}
    const obj=JSON.parse(raw) as {version?:unknown;savedAt?:unknown;expiresAt?:unknown;passport?:unknown};
    if(obj.version!==1 || typeof obj.savedAt!=="number" || typeof obj.expiresAt!=="number" ||
       obj.savedAt>now || obj.expiresAt<=now || obj.expiresAt-obj.savedAt>LIFETIME_MS ||
       !safePassport(obj.passport)){
      store.removeItem(KEY);
      return;
    }
    return obj.passport;
  }catch{
    try{store.removeItem(KEY);}catch{}
    return;
  }
}
export function clearGuestPassport(store:StorageLike):void {
  try{store.removeItem(KEY);}catch{}
}
