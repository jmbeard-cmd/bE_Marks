import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const storagePath = path.join(root, 'src', 'utils', 'storage.ts');
const groupDetailPath = path.join(root, 'app', 'group-detail.tsx');
const messagesPath = path.join(root, 'app', '(tabs)', 'messages.tsx');
const livingSpacesStoragePath = path.join(root, 'src', 'utils', 'living-spaces-storage.ts');
const nostrPath = path.join(root, 'src', 'utils', 'nostr.ts');
const store = new Map();
let setCalls = [];

const AsyncStorage = {
  async getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  async setItem(key, value) {
    setCalls.push([key, value]);
    store.set(key, value);
  },
  async removeItem(key) {
    store.delete(key);
  },
};

function resetStore(entries = {}) {
  store.clear();
  setCalls = [];
  Object.entries(entries).forEach(([key, value]) => {
    store.set(key, value);
  });
}

function milestone(overrides) {
  return {
    id: 'mark',
    note: 'Mark title\n\nBody',
    tags: [],
    createdAt: 1,
    publishedToRelay: false,
    media: [],
    ...overrides,
  };
}

function media(id, uri) {
  return { id, uri, type: 'image' };
}

function loadStorageModule() {
  const source = fs.readFileSync(storagePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const storageModule = new Module(storagePath);
  storageModule.filename = storagePath;
  storageModule.paths = Module._nodeModulePaths(root);

  const originalRequire = Module.prototype.require;
  Module.prototype.require = function patchedRequire(request) {
    if (request === '@react-native-async-storage/async-storage') {
      return { __esModule: true, default: AsyncStorage };
    }

    if (request === './dm-storage') {
      return { clearDMStorage: async () => undefined };
    }

    if (request === './group-storage') {
      return { clearGroupStorage: async () => undefined };
    }

    return originalRequire.apply(this, arguments);
  };

  try {
    storageModule._compile(transpiled, storagePath);
  } finally {
    Module.prototype.require = originalRequire;
  }

  return storageModule.exports;
}

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function extractBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing source marker: ${marker}`);

  const braceIndex = source.indexOf('{', markerIndex);
  assert.notEqual(braceIndex, -1, `missing block body for marker: ${marker}`);

  let depth = 0;

  for (let index = braceIndex; index < source.length; index += 1) {
    const char = source[index];

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return source.slice(markerIndex, index + 1);
      }
    }
  }

  throw new Error(`unterminated block for marker: ${marker}`);
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);

  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);

  return source.slice(start, end);
}

function assertOrdered(source, first, second, label) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);

  assert.notEqual(firstIndex, -1, `${label}: missing "${first}"`);
  assert.notEqual(secondIndex, -1, `${label}: missing "${second}"`);
  assert.ok(firstIndex < secondIndex, `${label}: "${first}" must appear before "${second}"`);
}

const {
  auditMilestonesForCorruption,
  getMilestoneEmergencyBackup,
  getMilestones,
  listMilestoneEmergencyBackups,
  saveRemoteMilestone,
  updateMilestone,
} = loadStorageModule();

async function testGetMilestonesDoesNotRepairWrite() {
  resetStore({
    milestones_v1: JSON.stringify([
      milestone({ id: 'dup', note: 'Duplicate', createdAt: 1, media: [media('a', 'file://a.jpg')] }),
      milestone({ id: 'dup', note: 'Duplicate copy', createdAt: 2, media: [media('b', 'file://b.jpg')] }),
    ]),
  });

  const result = await getMilestones();

  assert.equal(result.length, 2);
  assert.equal(setCalls.length, 0, 'getMilestones must not write or repair storage on read');
}

async function testMissingEventIdsDoNotMerge() {
  resetStore({
    milestones_v1: JSON.stringify([
      milestone({ id: 'a', note: 'A', media: [media('a1', 'file://a.jpg')] }),
      milestone({ id: 'b', note: 'B', media: [media('b1', 'file://b.jpg')] }),
    ]),
  });

  await saveRemoteMilestone(milestone({
    id: 'c',
    note: 'C',
    media: [media('c1', 'file://c.jpg')],
    nostrEventId: undefined,
  }));

  const result = JSON.parse(store.get('milestones_v1'));

  assert.equal(result.length, 3);
  assert.deepEqual(result.find(item => item.id === 'a').media.map(item => item.uri), ['file://a.jpg']);
  assert.deepEqual(result.find(item => item.id === 'b').media.map(item => item.uri), ['file://b.jpg']);
  assert.deepEqual(result.find(item => item.id === 'c').media.map(item => item.uri), ['file://c.jpg']);
}

async function testSameMarkIdCanMergeWithUniqueMediaKeys() {
  resetStore({
    milestones_v1: JSON.stringify([
      milestone({ id: 'same', media: [media('duplicate-media-id', 'file://one.jpg')] }),
    ]),
  });

  await saveRemoteMilestone(milestone({
    id: 'same',
    note: 'Same updated',
    media: [media('duplicate-media-id', 'file://two.jpg')],
  }));

  const [result] = JSON.parse(store.get('milestones_v1'));
  const mediaIds = result.media.map(item => item.id);

  assert.equal(result.media.length, 2);
  assert.equal(new Set(mediaIds).size, 2, 'merged same-Mark media must have unique render keys');
}

async function testSameEventDifferentIdsDoesNotMoveMedia() {
  resetStore({
    milestones_v1: JSON.stringify([
      milestone({
        id: 'original',
        nostrEventId: 'event-1',
        media: [media('original-media', 'file://original.jpg')],
      }),
    ]),
  });

  await saveRemoteMilestone(milestone({
    id: 'other-id',
    nostrEventId: 'event-1',
    media: [media('incoming-media', 'file://incoming.jpg')],
  }));

  const [result] = JSON.parse(store.get('milestones_v1'));

  assert.equal(result.id, 'original');
  assert.deepEqual(result.media.map(item => item.uri), ['file://original.jpg']);
}

async function testEmergencyBackupCreatedOnceBeforeWrite() {
  const original = JSON.stringify([
    milestone({ id: 'backup-source', note: 'Original note' }),
  ]);
  resetStore({ milestones_v1: original });

  await updateMilestone('backup-source', { note: 'Changed once' });
  await updateMilestone('backup-source', { note: 'Changed twice' });

  const backups = await listMilestoneEmergencyBackups();
  const backup = await getMilestoneEmergencyBackup(backups[0].key);

  assert.equal(backups.length, 1);
  assert.equal(backup.raw, original);
}

function testAuditIsReadOnlyAndFindsSuspects() {
  const audit = auditMilestonesForCorruption([
    milestone({ id: 'a', note: 'Shared title', media: [media('a1', 'file://shared.jpg')] }),
    milestone({ id: 'b', note: 'Shared title', media: [media('b1', 'file://shared.jpg')] }),
    milestone({ id: 'b', note: 'Different title', media: [] }),
  ]);

  assert.deepEqual(audit.duplicateIds, ['b']);
  assert.deepEqual(audit.duplicateMediaUris, [{ uri: 'file://shared.jpg', markIds: ['a', 'b'] }]);
  assert.deepEqual(audit.repeatedTitles, [{ title: 'shared title', markIds: ['a', 'b'] }]);
}

function testGetMilestonesSourceStaysReadOnly() {
  const source = readSource(storagePath);
  const block = extractBlock(source, 'export async function getMilestones');

  assert.ok(!block.includes('setItem('), 'getMilestones must not write AsyncStorage');
  assert.ok(!block.includes('removeItem('), 'getMilestones must not remove AsyncStorage keys');
  assert.ok(!block.includes('writeMilestones('), 'getMilestones must not call writeMilestones');
  assert.ok(!block.includes('saveRemoteMilestone('), 'getMilestones must not import or repair remote Marks');
}

function testSpaceMarkRelaySyncUsesSafeV2Gates() {
  const source = readSource(groupDetailPath);

  assert.ok(
    source.includes('const SPACE_MARK_RELAY_SYNC_ENABLED = true;'),
    'Space Mark relay sync should only be enabled after V2 import gates are present'
  );

  const syncBlock = extractBlock(source, 'const syncSpaceMarksFromRelay = useCallback');
  assertOrdered(
    syncBlock,
    'if (!SPACE_MARK_RELAY_SYNC_ENABLED) return [] as LivingMarkView[];',
    'fetchGroupMarks',
    'Space Mark fetch must be gated'
  );

  const backfillBlock = extractBlock(source, 'const backfillSpaceMarksToRelay = useCallback');
  assertOrdered(
    backfillBlock,
    'if (!SPACE_MARK_RELAY_SYNC_ENABLED || !canPublish || !nsec) return;',
    'publishSpaceMarkSnapshot',
    'Space Mark backfill must be gated'
  );

  const createBlock = extractBlock(source, 'const handleCreateSpaceMark = async () =>');
  assertOrdered(
    createBlock,
    'if (SPACE_MARK_RELAY_SYNC_ENABLED && nsec)',
    'publishGroupMark',
    'Space Mark creation must not publish unless relay sync is explicitly enabled'
  );

  const nostrSource = readSource(nostrPath);
  const publishBlock = sliceBetween(
    nostrSource,
    'export async function publishGroupMark',
    'export function fetchGroupMarks'
  );
  assertOrdered(
    publishBlock,
    'if (!input.milestone.authorNpub)',
    'const payload: NostrGroupMarkPayload =',
    'Space Mark publish must require author identity before creating payload'
  );
  assertOrdered(
    publishBlock,
    'if (!milestoneHasOnlyRemoteMedia(input.milestone))',
    'const payload: NostrGroupMarkPayload =',
    'Space Mark publish must reject local-only media before creating payload'
  );
  assert.ok(
    publishBlock.includes('schemaVersion: 2'),
    'Space Mark publish must use schemaVersion 2 payloads'
  );

  const fetchBlock = extractBlock(nostrSource, 'export function fetchGroupMarks');
  assertOrdered(
    fetchBlock,
    'if (parsed.schemaVersion !== 2) return;',
    'byMarkId.set(parsed.milestone.id, parsed);',
    'Space Mark fetch must ignore unversioned or non-V2 snapshots'
  );
}

function testSpaceMarkImportKeepsSelfOwnedLocalMarksSafe() {
  const source = readSource(livingSpacesStoragePath);
  const block = sliceBetween(
    source,
    'export async function importLivingSpaceMarkSnapshot',
    'export async function updateLivingMarkContext'
  );

  assertOrdered(block, 'const existingLocalMilestone', 'const isSelfImport', 'self-import guard setup');
  assertOrdered(block, 'if (!milestone.authorNpub)', 'const isSelfImport', 'Space Mark import must require author identity before import');
  assertOrdered(block, 'if (!milestoneHasOnlyRemoteMedia(milestone))', 'const isSelfImport', 'Space Mark import must reject local-only media before import');
  assertOrdered(block, 'existingLocalMilestone.authorNpub !== milestone.authorNpub', 'const isSelfImport', 'Space Mark import must skip unsafe id collisions before import');
  assertOrdered(block, 'const isSelfImport', 'if (!isSelfImport)', 'self-import check');
  assertOrdered(block, 'if (!isSelfImport)', 'await saveRemoteMilestone(milestone);', 'remote save must be behind self-import guard');
}

function testSpaceIdentityEditsRequireAdminInMessagesTab() {
  const source = readSource(messagesPath);

  const openEditBlock = extractBlock(source, 'const openEditGroup = async');
  assertOrdered(openEditBlock, 'const canEdit', 'if (!canEdit)', 'opening Space edit sheet must compute admin access first');
  assertOrdered(openEditBlock, 'if (!canEdit)', "setSheet('edit-group')", 'opening Space edit sheet must block non-admins');

  const saveEditBlock = extractBlock(source, 'const saveGroupSpaceEdits = async');
  assertOrdered(saveEditBlock, 'const canEdit', 'if (!canEdit)', 'saving Space identity must compute admin access first');
  assertOrdered(saveEditBlock, 'if (!canEdit)', 'await updateGroup(editingGroupId', 'saving Space identity must block non-admins');
  assertOrdered(saveEditBlock, 'await updateGroup(editingGroupId', 'publishGroupMetadataSnapshot', 'Space identity saves must publish metadata');
}

function testSpaceDetailAdminOnlyMutationsStayGuarded() {
  const source = readSource(groupDetailPath);

  const relayBlock = extractBlock(source, 'const saveGroupRelaySettings = async');
  assertOrdered(relayBlock, 'if (!isAdmin)', 'await updateGroup(group.id', 'relay settings must be admin-gated');
  assertOrdered(relayBlock, 'await updateGroup(group.id', 'publishCurrentGroupMetadata(group.id)', 'relay updates must publish metadata');

  const regenerateBlock = extractBlock(source, 'const handleRegenerateCode = () =>');
  assertOrdered(regenerateBlock, 'if (!isAdmin)', 'regenerateInviteCode', 'invite regeneration must be admin-gated');

  const archiveBlock = extractBlock(source, 'const handleArchive = () =>');
  assertOrdered(archiveBlock, 'if (!isAdmin)', 'archiveGroup(group.id)', 'archiving must be admin-gated');

  for (const marker of [
    'const enableSchoolConsentDefaults = async () =>',
    'const toggleSchoolMinorPolicy = async () =>',
    'const toggleDirectoryInfoAllowed = async () =>',
  ]) {
    const block = extractBlock(source, marker);
    assert.ok(
      block.includes('if (!group || !isAdmin) return;'),
      `${marker} must remain admin-gated`
    );
    assertOrdered(block, 'if (!group || !isAdmin) return;', 'await updateGroup(group.id', `${marker} updateGroup guard`);
    assertOrdered(block, 'await updateGroup(group.id', 'publishCurrentGroupMetadata(group.id)', `${marker} metadata publish`);
  }
}

await testGetMilestonesDoesNotRepairWrite();
await testMissingEventIdsDoNotMerge();
await testSameMarkIdCanMergeWithUniqueMediaKeys();
await testSameEventDifferentIdsDoesNotMoveMedia();
await testEmergencyBackupCreatedOnceBeforeWrite();
testAuditIsReadOnlyAndFindsSuspects();
testGetMilestonesSourceStaysReadOnly();
testSpaceMarkRelaySyncUsesSafeV2Gates();
testSpaceMarkImportKeepsSelfOwnedLocalMarksSafe();
testSpaceIdentityEditsRequireAdminInMessagesTab();
testSpaceDetailAdminOnlyMutationsStayGuarded();

console.log('storage safety tests passed');
