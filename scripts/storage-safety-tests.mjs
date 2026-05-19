import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const storagePath = path.join(root, 'src', 'utils', 'storage.ts');
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

await testGetMilestonesDoesNotRepairWrite();
await testMissingEventIdsDoNotMerge();
await testSameMarkIdCanMergeWithUniqueMediaKeys();
await testSameEventDifferentIdsDoesNotMoveMedia();
await testEmergencyBackupCreatedOnceBeforeWrite();
testAuditIsReadOnlyAndFindsSuspects();

console.log('storage safety tests passed');
