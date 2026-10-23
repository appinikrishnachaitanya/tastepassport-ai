import type { AgentState } from './types.ts';
import type { Section } from '../passport/model.ts';
const keys = ['queryPreferences','categoryConstraints','categoryTags','categoryModes','categoryConcepts','activityGenres','preferences'] as const;
export type RefinementSettings = { [K in typeof keys[number]]?: NonNullable<AgentState[K]>[Section] };
export function refinementSettings(state:AgentState, section:Section):RefinementSettings {
  return structuredClone(Object.fromEntries(keys.map(key=>[key,state[key]?.[section]]))) as RefinementSettings;
}
export function restoreRefinementSettings(state:AgentState,section:Section,settings:RefinementSettings):void {
  for (const key of keys) {
    if(settings[key] === undefined) { if(state[key])delete state[key]![section]; }
    else {
      // Each entry is copied from this exact category/key, never model metadata.
      const map = (state[key] ??= {}) as Record<string,unknown>;
      map[section] = structuredClone(settings[key]);
    }
  }
}
