import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  LivingMarkPermissions,
  LivingMarkPerson,
  SchoolConsentDecision,
  SchoolConsentPermissions,
  SchoolConsentRecord,
  SchoolGuardianProfile,
  SchoolMinorDefaultPolicy,
  SchoolStudentProfile,
} from '../types/living-spaces';
import type { BEGroup } from './group-storage';
import { getLivingPersonId } from './living-people';
import { normalizeLivingMarkPermissions } from './living-space-routing';

export const SCHOOL_CONSENT_NOTICE_VERSION = 'school-consent-v1';
export const SCHOOL_STUDENT_PROFILES_KEY = 'school_student_profiles_v1';
export const SCHOOL_GUARDIAN_PROFILES_KEY = 'school_guardian_profiles_v1';
export const SCHOOL_CONSENT_RECORDS_KEY = 'school_consent_records_v1';

export type SchoolConsentSummary = {
  students: SchoolStudentProfile[];
  guardian?: SchoolGuardianProfile;
  records: SchoolConsentRecord[];
  needsConsentCount: number;
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    console.warn(`[School Consent] failed to read ${key}:`, error);
    return fallback;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`[School Consent] failed to write ${key}:`, error);
  }
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function cleanText(value?: string | null): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

export function isSchoolConsentSpace(group?: Pick<BEGroup, 'spaceType' | 'requiresGuardianConsent'> | null): boolean {
  if (!group) return false;
  if (group.requiresGuardianConsent === true) return true;
  return group.spaceType === 'school' || group.spaceType === 'district' || group.spaceType === 'classroom';
}

export function getDefaultMinorMarkPolicy(group?: Pick<BEGroup, 'defaultMinorMarkPolicy'> | null): SchoolMinorDefaultPolicy {
  return group?.defaultMinorMarkPolicy ?? 'restricted';
}

export async function getSchoolStudentsForSpace(spaceId: string): Promise<SchoolStudentProfile[]> {
  const students = await readJson<SchoolStudentProfile[]>(SCHOOL_STUDENT_PROFILES_KEY, []);
  return students
    .filter(student => student.spaceId === spaceId)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getSchoolConsentRecordsForSpace(spaceId: string): Promise<SchoolConsentRecord[]> {
  const records = await readJson<SchoolConsentRecord[]>(SCHOOL_CONSENT_RECORDS_KEY, []);
  return records.filter(record => record.spaceId === spaceId);
}

export async function getGuardianProfile(spaceId: string, guardianNpub?: string | null): Promise<SchoolGuardianProfile | undefined> {
  const npub = cleanText(guardianNpub)?.toLowerCase();
  if (!npub) return undefined;

  const guardians = await readJson<SchoolGuardianProfile[]>(SCHOOL_GUARDIAN_PROFILES_KEY, []);
  return guardians.find(guardian => guardian.spaceId === spaceId && guardian.npub.toLowerCase() === npub);
}

export async function getSchoolSpaceConsentSummary(
  spaceId: string,
  guardianNpub?: string | null
): Promise<SchoolConsentSummary> {
  const [students, records, guardian] = await Promise.all([
    getSchoolStudentsForSpace(spaceId),
    getSchoolConsentRecordsForSpace(spaceId),
    getGuardianProfile(spaceId, guardianNpub),
  ]);

  const latestRecordByStudent = getLatestConsentRecordMap(records);
  const needsConsentCount = students.filter(student => {
    if (!student.under13) return false;
    const record = latestRecordByStudent.get(student.id);
    return !record || record.consentStatus !== 'granted' || record.permissions.restricted === true;
  }).length;

  return {
    students,
    records,
    guardian,
    needsConsentCount,
  };
}

export async function upsertGuardianProfile(input: {
  spaceId: string;
  npub: string;
  displayName?: string;
  linkedStudentIds?: string[];
  contactPreference?: SchoolGuardianProfile['contactPreference'];
  now?: number;
}): Promise<SchoolGuardianProfile> {
  const now = input.now ?? nowSeconds();
  const npub = input.npub.trim().toLowerCase();
  const guardians = await readJson<SchoolGuardianProfile[]>(SCHOOL_GUARDIAN_PROFILES_KEY, []);
  const index = guardians.findIndex(guardian => guardian.spaceId === input.spaceId && guardian.npub.toLowerCase() === npub);
  const existing = index >= 0 ? guardians[index] : undefined;
  const linkedStudentIds = Array.from(new Set([
    ...(existing?.linkedStudentIds ?? []),
    ...(input.linkedStudentIds ?? []),
  ]));
  const guardian: SchoolGuardianProfile = {
    id: existing?.id ?? `guardian_${input.spaceId}_${npub}`,
    spaceId: input.spaceId,
    npub,
    displayName: cleanText(input.displayName) ?? existing?.displayName,
    linkedStudentIds,
    contactPreference: input.contactPreference ?? existing?.contactPreference ?? 'app',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (index >= 0) guardians[index] = guardian;
  else guardians.push(guardian);

  await writeJson(SCHOOL_GUARDIAN_PROFILES_KEY, guardians);
  return guardian;
}

export async function upsertSchoolStudentProfile(input: {
  spaceId: string;
  displayName: string;
  personId?: string;
  grade?: string;
  className?: string;
  teamName?: string;
  under13?: boolean;
  guardianNpub?: string | null;
  now?: number;
}): Promise<SchoolStudentProfile> {
  const now = input.now ?? nowSeconds();
  const displayName = cleanText(input.displayName) ?? 'Student';
  const personId = getLivingPersonId({
    id: input.personId,
    displayName,
  });
  const students = await readJson<SchoolStudentProfile[]>(SCHOOL_STUDENT_PROFILES_KEY, []);
  const index = students.findIndex(student =>
    student.spaceId === input.spaceId &&
    student.personId.toLowerCase() === personId.toLowerCase()
  );
  const existing = index >= 0 ? students[index] : undefined;
  const guardianNpub = cleanText(input.guardianNpub)?.toLowerCase();
  const guardianNpubs = Array.from(new Set([
    ...(existing?.guardianNpubs ?? []),
    ...(guardianNpub ? [guardianNpub] : []),
  ]));
  const student: SchoolStudentProfile = {
    id: existing?.id ?? `student_${input.spaceId}_${personId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    spaceId: input.spaceId,
    personId,
    displayName,
    grade: cleanText(input.grade) ?? existing?.grade,
    className: cleanText(input.className) ?? existing?.className,
    teamName: cleanText(input.teamName) ?? existing?.teamName,
    under13: input.under13 ?? existing?.under13 ?? true,
    guardianNpubs,
    consentStatus: existing?.consentStatus ?? 'missing',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (index >= 0) students[index] = student;
  else students.push(student);

  await writeJson(SCHOOL_STUDENT_PROFILES_KEY, students);

  if (guardianNpub) {
    await upsertGuardianProfile({
      spaceId: input.spaceId,
      npub: guardianNpub,
      linkedStudentIds: [student.id],
      now,
    });
  }

  return student;
}

export async function upsertSchoolConsentRecord(input: {
  spaceId: string;
  studentId: string;
  guardianNpub?: string | null;
  permissions: SchoolConsentPermissions;
  consentStatus?: SchoolConsentRecord['consentStatus'];
  noticeVersion?: string;
  source?: SchoolConsentRecord['source'];
  now?: number;
}): Promise<SchoolConsentRecord> {
  const now = input.now ?? nowSeconds();
  const records = await readJson<SchoolConsentRecord[]>(SCHOOL_CONSENT_RECORDS_KEY, []);
  const guardianNpub = cleanText(input.guardianNpub)?.toLowerCase();
  const record: SchoolConsentRecord = {
    id: `consent_${input.spaceId}_${input.studentId}_${now}`,
    spaceId: input.spaceId,
    studentId: input.studentId,
    guardianNpub,
    consentStatus: input.consentStatus ?? 'granted',
    permissions: {
      media: input.permissions.media === true,
      name: input.permissions.name === true,
      mantle: input.permissions.mantle === true,
      legacy: input.permissions.legacy === true,
      restricted: input.permissions.restricted === true,
    },
    noticeVersion: input.noticeVersion ?? SCHOOL_CONSENT_NOTICE_VERSION,
    source: input.source ?? (guardianNpub ? 'guardian' : 'school-admin'),
    createdAt: now,
    updatedAt: now,
    revokedAt: input.consentStatus === 'revoked' ? now : undefined,
  };

  records.push(record);
  await writeJson(SCHOOL_CONSENT_RECORDS_KEY, records);

  const students = await readJson<SchoolStudentProfile[]>(SCHOOL_STUDENT_PROFILES_KEY, []);
  const updatedStudents = students.map(student =>
    student.id === input.studentId
      ? {
          ...student,
          consentStatus: record.consentStatus,
          updatedAt: now,
          guardianNpubs: guardianNpub
            ? Array.from(new Set([...student.guardianNpubs, guardianNpub]))
            : student.guardianNpubs,
        }
      : student
  );
  await writeJson(SCHOOL_STUDENT_PROFILES_KEY, updatedStudents);

  if (guardianNpub) {
    await upsertGuardianProfile({
      spaceId: input.spaceId,
      npub: guardianNpub,
      linkedStudentIds: [input.studentId],
      now,
    });
  }

  return record;
}

function getLatestConsentRecordMap(records: SchoolConsentRecord[]): Map<string, SchoolConsentRecord> {
  const map = new Map<string, SchoolConsentRecord>();

  for (const record of records) {
    const existing = map.get(record.studentId);
    if (!existing || record.updatedAt > existing.updatedAt) {
      map.set(record.studentId, record);
    }
  }

  return map;
}

function personMatchesStudent(person: LivingMarkPerson, student: SchoolStudentProfile): boolean {
  const personId = getLivingPersonId(person).toLowerCase();
  return (
    personId === student.personId.toLowerCase() ||
    person.npub?.toLowerCase() === student.personId.toLowerCase() ||
    person.displayName?.trim().toLowerCase() === student.displayName.trim().toLowerCase()
  );
}

function hasNeededConsent(record: SchoolConsentRecord | undefined, permissions: LivingMarkPermissions): boolean {
  if (!record || record.consentStatus !== 'granted') return false;
  if (record.permissions.restricted === true) return false;
  if (record.permissions.media !== true) return false;
  if (permissions.highlightApproved && record.permissions.mantle !== true) return false;
  if (permissions.bookApproved && record.permissions.legacy !== true) return false;
  return true;
}

export async function getSchoolConsentDecisionForMark(input: {
  group?: BEGroup | null;
  people: LivingMarkPerson[];
  permissions?: LivingMarkPermissions;
}): Promise<SchoolConsentDecision> {
  const group = input.group;

  if (!group || !isSchoolConsentSpace(group)) {
    return {
      applies: false,
      needsConsent: false,
      restricted: false,
      privateSpaceOnly: false,
      affectedStudentNames: [],
    };
  }

  const [students, records] = await Promise.all([
    getSchoolStudentsForSpace(group.id),
    getSchoolConsentRecordsForSpace(group.id),
  ]);
  const latestRecordByStudent = getLatestConsentRecordMap(records);
  const permissions = normalizeLivingMarkPermissions(input.permissions);
  const matchedStudents = students.filter(student =>
    student.under13 &&
    input.people.some(person => personMatchesStudent(person, student))
  );

  if (matchedStudents.length === 0) {
    return {
      applies: true,
      needsConsent: false,
      restricted: false,
      privateSpaceOnly: false,
      affectedStudentNames: [],
    };
  }

  const missingConsentStudents = matchedStudents.filter(student =>
    !hasNeededConsent(latestRecordByStudent.get(student.id), permissions)
  );

  if (missingConsentStudents.length === 0) {
    return {
      applies: true,
      needsConsent: false,
      restricted: false,
      privateSpaceOnly: false,
      reason: 'Guardian consent satisfied',
      affectedStudentNames: matchedStudents.map(student => student.displayName),
    };
  }

  const policy = getDefaultMinorMarkPolicy(group);

  return {
    applies: true,
    needsConsent: true,
    restricted: policy === 'restricted',
    privateSpaceOnly: policy === 'privateSpaceOnly',
    reason: 'Guardian consent needed',
    affectedStudentNames: missingConsentStudents.map(student => student.displayName),
  };
}

export function applySchoolConsentDecisionToPermissions(
  permissions: LivingMarkPermissions,
  decision: SchoolConsentDecision
): LivingMarkPermissions {
  const normalized = normalizeLivingMarkPermissions(permissions);

  if (!decision.applies) return normalized;

  if (!decision.needsConsent) {
    return {
      ...normalized,
      guardianConsentNeeded: false,
      guardianConsentSatisfied: decision.affectedStudentNames.length > 0,
    };
  }

  return normalizeLivingMarkPermissions({
    ...normalized,
    privateSpaceOnly: decision.privateSpaceOnly || normalized.privateSpaceOnly,
    highlightApproved: false,
    bookApproved: false,
    restricted: decision.restricted || normalized.restricted,
    guardianConsentNeeded: true,
    guardianConsentSatisfied: false,
  });
}
