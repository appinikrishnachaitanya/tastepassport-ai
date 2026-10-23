import { sectionTypes, type Candidate, type Section } from './model.ts';

/** Activities choose outputs; confirmed interests are inputs, never invented venue tags. */
export function suggestedSections(tastes: Candidate[]): Section[] {
  const sections = new Set<Section>();
  for (const taste of tastes) {
    if (taste.id.startsWith('urn:tag:')) {
      const text = `${taste.id} ${taste.name}`;
      if (/coffee|caf[eé]|tea house/i.test(text)) sections.add('Coffee');
      else if (/cuisine|dish|food|restaurant|savour/i.test(text)) sections.add('Eat');
      else if (/museum|gallery|theatre|cinema|culture/i.test(text)) sections.add('Culture');
      else if (/bookstore|shopping|boutique/i.test(text)) sections.add('Lifestyle');
      continue;
    }
    for (const [section, type] of Object.entries(sectionTypes)) {
      if (type !== 'place' && taste.types.includes(`urn:entity:${type}`)) sections.add(section as Section);
    }
  }
  // Unclassified interests support mixed place discovery, not a fabricated taste inference.
  return sections.size ? [...sections].slice(0, 5) : ['Eat', 'Culture'];
}

export function conceptSections(concept: string, targets: Section[]): Section[] {
  const text = concept.toLowerCase();
  const scoped: Section[] = /coffee|caf[eé]/.test(text) ? ['Coffee']
    : /cuisine|biryani|vegetarian|seafood|dish|restaurant|pizza|sushi|thai|indian|italian|mexican/.test(text) ? ['Eat']
    : /museum|gallery|theatre|cinema|nightclub|nightlife|live music|concert/.test(text) ? ['Culture']
    : /bookstore|book shop/.test(text) ? ['Lifestyle'] : targets;
  return scoped.filter(section => targets.includes(section));
}
