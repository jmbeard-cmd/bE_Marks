import type { LivingMarkPerson } from '../types/living-spaces';

export type LivingPersonSource =
  | 'current-user'
  | 'space-member'
  | 'family-member'
  | 'contact'
  | 'manual'
  | 'derived';

export type LivingPersonCandidate = {
  id: string;
  npub?: string;
  displayName: string;
  avatarUrl?: string;
  source: LivingPersonSource;
};

export type LivingPersonSeed = {
  npub?: string | null;
  displayName?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  source: LivingPersonSource;
};

function cleanText(value?: string | null): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function normalizeNameSlug(value: string): string {
  return value
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function isNpub(value?: string | null): boolean {
  return /^npub1[023456789acdefghjklmnpqrstuvwxyz]+$/i.test(value?.trim() ?? '');
}

export function getPersonDisplayName(person: LivingMarkPerson): string {
  return (
    cleanText(person.displayName) ||
    cleanText(person.id)?.replace(/^name:/, '') ||
    cleanText(person.npub)?.slice(0, 12) ||
    'Person'
  );
}

export function getLivingPersonId(input: {
  npub?: string | null;
  displayName?: string | null;
  id?: string | null;
}): string {
  const npub = cleanText(input.npub);
  if (npub) return npub.toLowerCase();

  const explicitId = cleanText(input.id);
  if (explicitId?.startsWith('name:') || explicitId?.startsWith('npub1')) {
    return explicitId.toLowerCase();
  }

  const name = cleanText(input.displayName) || explicitId;
  const slug = name ? normalizeNameSlug(name) : '';
  return slug ? `name:${slug}` : 'name:person';
}

export function getLivingPersonKey(person: Pick<LivingMarkPerson, 'id' | 'npub' | 'displayName'>): string {
  return getLivingPersonId(person).toLowerCase();
}

export function createLivingPerson(input: {
  npub?: string | null;
  displayName?: string | null;
  id?: string | null;
  avatarUrl?: string | null;
  source?: LivingPersonSource;
  role?: LivingMarkPerson['role'];
}): LivingMarkPerson {
  const npub = cleanText(input.npub);
  const displayName = cleanText(input.displayName);
  const id = getLivingPersonId({
    npub,
    displayName,
    id: input.id,
  });

  return {
    id,
    npub: npub || undefined,
    displayName: displayName || (npub ? `${npub.slice(0, 12)}...` : id.replace(/^name:/, '')),
    avatarUrl: cleanText(input.avatarUrl),
    source: input.source ?? (npub ? 'derived' : 'manual'),
    role: input.role ?? 'subject',
  };
}

export function createLivingPersonCandidate(seed: LivingPersonSeed): LivingPersonCandidate | null {
  const npub = cleanText(seed.npub);
  const displayName = cleanText(seed.displayName) || cleanText(seed.name) || (npub ? `${npub.slice(0, 12)}...` : undefined);

  if (!npub && !displayName) return null;

  return {
    id: getLivingPersonId({ npub, displayName }),
    npub,
    displayName: displayName ?? 'Person',
    avatarUrl: cleanText(seed.avatarUrl),
    source: seed.source,
  };
}

export function livingPersonFromCandidate(
  candidate: LivingPersonCandidate,
  role: LivingMarkPerson['role'] = 'subject'
): LivingMarkPerson {
  return createLivingPerson({
    id: candidate.id,
    npub: candidate.npub,
    displayName: candidate.displayName,
    avatarUrl: candidate.avatarUrl,
    source: candidate.source,
    role,
  });
}

export function mergeLivingPersonCandidates(seeds: LivingPersonSeed[]): LivingPersonCandidate[] {
  const seen = new Set<string>();
  const result: LivingPersonCandidate[] = [];

  for (const seed of seeds) {
    const candidate = createLivingPersonCandidate(seed);
    if (!candidate) continue;

    const key = candidate.id.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(candidate);
  }

  return result.sort((a, b) => {
    if (a.source === 'current-user') return -1;
    if (b.source === 'current-user') return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function parsePeopleInput(input: string): LivingMarkPerson[] {
  return input
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item =>
      createLivingPerson({
        npub: isNpub(item) ? item : undefined,
        displayName: isNpub(item) ? undefined : item,
        id: isNpub(item) ? item : undefined,
        source: 'manual',
        role: 'subject',
      })
    );
}

export function toggleLivingPersonSelection(
  selectedPeople: LivingMarkPerson[],
  candidate: LivingPersonCandidate
): LivingMarkPerson[] {
  const key = candidate.id.toLowerCase();
  const exists = selectedPeople.some(person => getLivingPersonKey(person) === key);

  if (exists) {
    return selectedPeople.filter(person => getLivingPersonKey(person) !== key);
  }

  return [...selectedPeople, livingPersonFromCandidate(candidate)];
}

export function isLivingPersonSelected(
  selectedPeople: LivingMarkPerson[],
  candidate: LivingPersonCandidate
): boolean {
  const key = candidate.id.toLowerCase();
  return selectedPeople.some(person => getLivingPersonKey(person) === key);
}

export function resolvePeopleSelection(input: {
  selectedPeople: LivingMarkPerson[];
  manualInput?: string;
}): { people: LivingMarkPerson[]; peopleIds: string[] } {
  return normalizeLivingPeople({
    people: [...input.selectedPeople, ...parsePeopleInput(input.manualInput ?? '')],
    fallbackRole: 'subject',
  });
}

export function normalizeLivingPeople(input: {
  people?: LivingMarkPerson[];
  peopleIds?: string[];
  fallbackRole?: LivingMarkPerson['role'];
}): { people: LivingMarkPerson[]; peopleIds: string[] } {
  const people: LivingMarkPerson[] = [];
  const seen = new Set<string>();

  const addPerson = (person: LivingMarkPerson) => {
    const id = getLivingPersonId({
      npub: person.npub,
      displayName: person.displayName,
      id: person.id,
    });
    const key = id.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    people.push({
      ...person,
      id,
      npub: cleanText(person.npub),
      displayName: cleanText(person.displayName) || getPersonDisplayName({ ...person, id }),
      role: person.role ?? input.fallbackRole ?? 'subject',
    });
  };

  for (const person of input.people ?? []) {
    addPerson(person);
  }

  for (const peopleId of input.peopleIds ?? []) {
    const clean = cleanText(peopleId);
    if (!clean) continue;

    addPerson(
      createLivingPerson({
        npub: isNpub(clean) ? clean : undefined,
        id: clean,
        displayName: isNpub(clean) ? undefined : clean.replace(/^name:/, ''),
        source: clean.startsWith('name:') || !isNpub(clean) ? 'manual' : 'derived',
        role: input.fallbackRole ?? 'subject',
      })
    );
  }

  return {
    people,
    peopleIds: people.map(person => getLivingPersonId(person)),
  };
}

export function livingPeopleToInput(people: LivingMarkPerson[] = [], peopleIds: string[] = []): string {
  const normalized = normalizeLivingPeople({ people, peopleIds });
  return normalized.people
    .filter(person => person.role !== 'author')
    .map(person => person.npub || person.displayName || person.id)
    .filter(Boolean)
    .join(', ');
}
