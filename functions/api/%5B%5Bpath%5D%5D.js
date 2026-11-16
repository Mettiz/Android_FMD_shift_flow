/**
 * Cloudflare Pages Function: /api/sync, /api/sync/reset, /api/sync/snapshots, /api/sync/restore, /api/sync/stream, /api/sync/health, /api/sync/audit
 * Stores ShiftFlow roster state & snapshots durably in Cloudflare D1 (when bound via `DB`)
 * and mirrors seamlessly with Firestore REST and the ShiftFlow Worker relay.
 */

const FIRESTORE_DOC_URL =
  'https://firestore.googleapis.com/v1/projects/beaming-source-hcbh2/databases/ai-studio-fmdproductionshi-3f0608ec-b995-44d1-a9c8-f98c589f0e16/documents/roster_state/current';
const WORKER_RELAY_BASE = 'https://fmd-shift-flow.mehdi8705-68c.workers.dev';
const LEGACY_STALE_SCHEDULE_HASH = '88aedc2d';
const MAX_SNAPSHOTS = 30;

const SECTION_KEYS = new Set([
  'schedule',
  'personnelList',
  'dailyProcesses',
  'processDefinitions',
  'productionBatches',
]);
const META_KEYS = new Set([
  'updatedAt',
  '_version',
  '_revision',
  '_originClientId',
  'adminPassword',
  'showProcessSchedule',
  'publishedRange',
  'unlockedMonths',
]);

let memoryCache = null;
let lastUpstreamCheckTime = 0;
const UPSTREAM_TTL_MS = 10000;
let isFirestoreQuotaExhausted = false;
let lastQuotaCheckTime = 0;
const initializedDbs = new WeakSet();
const schemaInitPromises = new WeakMap();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cache-Control, Accept, Authorization, X-ShiftFlow-Secret',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Content-Type': 'application/json; charset=utf-8',
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders },
  });
}

function resolveD1Binding(env) {
  if (!env || typeof env !== 'object') return null;
  const preferred = ['DB', 'D1', 'SHIFTFLOW_DB', 'shiftflow_db'];
  for (const key of preferred) {
    const candidate = env[key];
    if (candidate && typeof candidate.prepare === 'function' && typeof candidate.batch === 'function') {
      return candidate;
    }
  }
  for (const value of Object.values(env)) {
    if (value && typeof value === 'object' && typeof value.prepare === 'function' && typeof value.batch === 'function') {
      return value;
    }
  }
  return null;
}

function isAuthorizedWrite(request, env) {
  const secret = env?.SYNC_WRITE_SECRET;
  if (!secret || typeof secret !== 'string' || !secret.trim()) return true;
  const headerSecret = request.headers.get('X-ShiftFlow-Secret');
  const authHeader = request.headers.get('Authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return headerSecret === secret || bearerToken === secret;
}

async function ensureD1Schema(db) {
  if (!db) return false;
  if (initializedDbs.has(db)) return true;
  if (schemaInitPromises.has(db)) {
    return schemaInitPromises.get(db);
  }

  const initPromise = (async () => {
    try {
      await db.batch([
        db.prepare(
          'CREATE TABLE IF NOT EXISTS roster_meta (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0, origin_client_id TEXT, sched_hash TEXT, admin_password TEXT, show_process_schedule INTEGER NOT NULL DEFAULT 1, published_range_json TEXT, unlocked_months_json TEXT)'
        ),
        db.prepare(
          'CREATE TABLE IF NOT EXISTS roster_sections (section_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL)'
        ),
        db.prepare(
          'CREATE TABLE IF NOT EXISTS sync_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, event TEXT NOT NULL, client_id TEXT, origin TEXT, updated_at TEXT, version INTEGER, revision INTEGER, sched_hash TEXT, details_json TEXT)'
        ),
        db.prepare(
          'CREATE TABLE IF NOT EXISTS roster_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, snapshot_type TEXT NOT NULL, label TEXT, version INTEGER, revision INTEGER, sched_hash TEXT, shift_count INTEGER NOT NULL DEFAULT 0, payload_json TEXT NOT NULL)'
        ),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_sync_audit_recent ON sync_audit (id DESC)'),
        db.prepare('CREATE INDEX IF NOT EXISTS idx_roster_snapshots_recent ON roster_snapshots (id DESC)'),
      ]);
      initializedDbs.add(db);
      return true;
    } catch (err) {
      console.error('[Pages D1] Schema initialization failed:', err);
      return false;
    } finally {
      schemaInitPromises.delete(db);
    }
  })();

  schemaInitPromises.set(db, initPromise);
  return initPromise;
}

function safeJsonParse(raw, fallback = null) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getSchedHash(sched) {
  if (!Array.isArray(sched) || sched.length === 0) return 'empty';
  const str = sched
    .map(
      (s) =>
        `${s.date}:${s.dayShiftPerson || ''}:${s.nightShiftPerson || ''}:${s.onCallPerson || ''}:${(
          s.extraDayPersons || []
        ).join(',')}:${(s.extraNightPersons || []).join(',')}`
    )
    .join('|');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function nextMonotonicTimestamp(...existingIsos) {
  let maxMs = Date.now();
  for (const iso of existingIsos) {
    if (iso && typeof iso === 'string') {
      const parsed = Date.parse(iso);
      if (Number.isFinite(parsed) && parsed >= maxMs) {
        maxMs = parsed + 1;
      }
    }
  }
  return new Date(maxMs).toISOString();
}

function isCandidateNewer(candidate, baseline) {
  if (!candidate) return false;
  if (!baseline) return true;
  const candTs = candidate.updatedAt || '';
  const baseTs = baseline.updatedAt || '';
  if (candTs && baseTs && candTs !== baseTs) return candTs > baseTs;
  if (candTs && !baseTs) return true;
  const candRev = typeof candidate._revision === 'number' ? candidate._revision : 0;
  const baseRev = typeof baseline._revision === 'number' ? baseline._revision : 0;
  if (candRev !== baseRev) return candRev > baseRev;
  const candVer = typeof candidate._version === 'number' ? candidate._version : 0;
  const baseVer = typeof baseline._version === 'number' ? baseline._version : 0;
  return candVer > baseVer;
}

async function readStateFromD1(db) {
  if (!db) return null;
  const schemaOk = await ensureD1Schema(db);
  if (!schemaOk) return null;

  const meta = await db.prepare('SELECT * FROM roster_meta WHERE id = ?').bind('current').first();
  if (!meta) return null;

  const sectionsResult = await db.prepare('SELECT section_key, payload_json FROM roster_sections').all();
  const rows = Array.isArray(sectionsResult?.results) ? sectionsResult.results : [];

  let extra = {};
  const state = {
    updatedAt: meta.updated_at,
    _version: typeof meta.version === 'number' ? meta.version : 1,
    _revision: typeof meta.revision === 'number' ? meta.revision : 0,
    ...(meta.origin_client_id ? { _originClientId: meta.origin_client_id } : {}),
    ...(meta.admin_password ? { adminPassword: meta.admin_password } : {}),
    showProcessSchedule: meta.show_process_schedule !== 0,
    publishedRange: safeJsonParse(meta.published_range_json, null),
    unlockedMonths: safeJsonParse(meta.unlocked_months_json, []),
  };

  for (const row of rows) {
    const parsed = safeJsonParse(row.payload_json, undefined);
    if (parsed === undefined) continue;
    if (row.section_key === 'extra' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      extra = parsed;
    } else if (SECTION_KEYS.has(row.section_key)) {
      state[row.section_key] = parsed;
    }
  }

  return { ...extra, ...state };
}

async function writeStateToD1(db, state, auditInfo = null) {
  if (!db || !state) return false;
  const schemaOk = await ensureD1Schema(db);
  if (!schemaOk) return false;

  const nowIso = state.updatedAt || new Date().toISOString();
  const version = typeof state._version === 'number' ? state._version : 1;
  const revision = typeof state._revision === 'number' ? state._revision : 0;
  const schedHash = getSchedHash(state.schedule);
  const showProc = state.showProcessSchedule === false ? 0 : 1;
  const publishedJson =
    state.publishedRange !== undefined && state.publishedRange !== null
      ? JSON.stringify(state.publishedRange)
      : null;
  const unlockedJson = Array.isArray(state.unlockedMonths)
    ? JSON.stringify(state.unlockedMonths)
    : '[]';

  const extraObj = {};
  for (const [key, val] of Object.entries(state)) {
    if (val !== undefined && !SECTION_KEYS.has(key) && !META_KEYS.has(key)) {
      extraObj[key] = val;
    }
  }

  const statements = [
    db
      .prepare(
        `INSERT INTO roster_meta (
          id, updated_at, version, revision, origin_client_id, sched_hash,
          admin_password, show_process_schedule, published_range_json, unlocked_months_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          updated_at = excluded.updated_at,
          version = excluded.version,
          revision = excluded.revision,
          origin_client_id = excluded.origin_client_id,
          sched_hash = excluded.sched_hash,
          admin_password = excluded.admin_password,
          show_process_schedule = excluded.show_process_schedule,
          published_range_json = excluded.published_range_json,
          unlocked_months_json = excluded.unlocked_months_json`
      )
      .bind(
        'current',
        nowIso,
        version,
        revision,
        state._originClientId || null,
        schedHash,
        state.adminPassword || null,
        showProc,
        publishedJson,
        unlockedJson
      ),
  ];

  for (const sectionKey of SECTION_KEYS) {
    if (state[sectionKey] !== undefined) {
      statements.push(
        db
          .prepare(
            `INSERT INTO roster_sections (section_key, payload_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(section_key) DO UPDATE SET
               payload_json = excluded.payload_json,
               updated_at = excluded.updated_at`
          )
          .bind(sectionKey, JSON.stringify(state[sectionKey]), nowIso)
      );
    }
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO roster_sections (section_key, payload_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(section_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`
      )
      .bind('extra', JSON.stringify(extraObj), nowIso)
  );

  if (auditInfo && auditInfo.event) {
    statements.push(
      db
        .prepare(
          `INSERT INTO sync_audit (ts, event, client_id, origin, updated_at, version, revision, sched_hash, details_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          new Date().toISOString(),
          auditInfo.event,
          auditInfo.clientId || state._originClientId || null,
          auditInfo.origin || 'cloudflare-pages-function',
          nowIso,
          version,
          revision,
          schedHash,
          auditInfo.details ? JSON.stringify(auditInfo.details) : null
        )
    );
    statements.push(
      db.prepare(
        'DELETE FROM sync_audit WHERE id NOT IN (SELECT id FROM sync_audit ORDER BY id DESC LIMIT 200)'
      )
    );
  }

  await db.batch(statements);
  return true;
}

async function createSnapshotInD1(db, state, { type = 'manual', label = '', skipIfIdentical = false } = {}) {
  if (!db || !state) return null;
  const schemaOk = await ensureD1Schema(db);
  if (!schemaOk) return null;

  const schedHash = getSchedHash(state.schedule);
  const version = typeof state._version === 'number' ? state._version : 1;
  const revision = typeof state._revision === 'number' ? state._revision : 0;
  const shiftCount = Array.isArray(state.schedule) ? state.schedule.length : 0;

  if (skipIfIdentical) {
    const latest = await db
      .prepare('SELECT id, sched_hash, revision, version FROM roster_snapshots ORDER BY id DESC LIMIT 1')
      .first();
    if (latest && latest.sched_hash === schedHash && latest.revision === revision && latest.version === version) {
      return { skipped: true, id: latest.id };
    }
  }

  const createdAt = new Date().toISOString();
  const safeLabel = label || (type === 'pre_reset' ? 'بکاپ ایمنی پیش از ریست' : type === 'pre_restore' ? 'بکاپ ایمنی پیش از بازیابی' : 'اسنپ‌شات دستی');

  await db.batch([
    db
      .prepare(
        `INSERT INTO roster_snapshots (created_at, snapshot_type, label, version, revision, sched_hash, shift_count, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(createdAt, type, safeLabel, version, revision, schedHash, shiftCount, JSON.stringify(state)),
    db.prepare(
      `DELETE FROM roster_snapshots WHERE id NOT IN (SELECT id FROM roster_snapshots ORDER BY id DESC LIMIT ${MAX_SNAPSHOTS})`
    ),
  ]);

  const inserted = await db
    .prepare('SELECT id, created_at, snapshot_type, label, version, revision, sched_hash, shift_count FROM roster_snapshots ORDER BY id DESC LIMIT 1')
    .first();

  return inserted
    ? {
        id: inserted.id,
        createdAt: inserted.created_at,
        type: inserted.snapshot_type,
        label: inserted.label,
        version: inserted.version,
        revision: inserted.revision,
        schedHash: inserted.sched_hash,
        shiftCount: inserted.shift_count,
      }
    : null;
}

async function listSnapshotsFromD1(db, limit = 20) {
  if (!db) return [];
  const schemaOk = await ensureD1Schema(db);
  if (!schemaOk) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), MAX_SNAPSHOTS);
  const res = await db
    .prepare(
      'SELECT id, created_at, snapshot_type, label, version, revision, sched_hash, shift_count FROM roster_snapshots ORDER BY id DESC LIMIT ?'
    )
    .bind(safeLimit)
    .all();
  const rows = Array.isArray(res?.results) ? res.results : [];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    type: r.snapshot_type,
    label: r.label,
    version: r.version,
    revision: r.revision,
    schedHash: r.sched_hash,
    shiftCount: r.shift_count,
  }));
}

async function getSnapshotPayloadFromD1(db, snapshotId) {
  if (!db) return null;
  const schemaOk = await ensureD1Schema(db);
  if (!schemaOk) return null;
  const row = await db
    .prepare('SELECT id, created_at, snapshot_type, label, payload_json FROM roster_snapshots WHERE id = ?')
    .bind(Number(snapshotId))
    .first();
  if (!row) return null;
  const payload = safeJsonParse(row.payload_json, null);
  if (!payload) return null;
  return { meta: row, payload };
}

async function countSnapshotsInD1(db) {
  if (!db) return 0;
  try {
    const schemaOk = await ensureD1Schema(db);
    if (!schemaOk) return 0;
    const row = await db.prepare('SELECT COUNT(*) AS cnt FROM roster_snapshots').first();
    return Number(row?.cnt || 0);
  } catch {
    return 0;
  }
}

async function readAuditFromD1(db, limit = 50) {
  if (!db) return [];
  const schemaOk = await ensureD1Schema(db);
  if (!schemaOk) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const res = await db
    .prepare(
      'SELECT id, ts, event, client_id, origin, updated_at, version, revision, sched_hash, details_json FROM sync_audit ORDER BY id DESC LIMIT ?'
    )
    .bind(safeLimit)
    .all();
  const rows = Array.isArray(res?.results) ? res.results : [];
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    event: r.event,
    clientId: r.client_id,
    origin: r.origin,
    updatedAt: r.updated_at,
    version: r.version,
    revision: r.revision,
    schedHash: r.sched_hash,
    details: safeJsonParse(r.details_json, undefined),
  }));
}

function decodeValue(val) {
  if (!val || typeof val !== 'object') return val;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    const values = val.arrayValue && Array.isArray(val.arrayValue.values) ? val.arrayValue.values : [];
    return values.map(decodeValue);
  }
  if ('mapValue' in val) {
    const out = {};
    const fields = (val.mapValue && val.mapValue.fields) || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeValue(v);
    }
    return out;
  }
  return val;
}

function decodeDoc(doc) {
  if (!doc || !doc.fields) return null;
  const out = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = decodeValue(v);
  }
  return out;
}

function encodeValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(encodeValue) } };
  }
  if (typeof val === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = encodeValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function encodeDoc(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) fields[k] = encodeValue(v);
  }
  return { fields };
}

async function fetchFromFirestore() {
  const now = Date.now();
  if (isFirestoreQuotaExhausted && now - lastQuotaCheckTime < 3600000) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(FIRESTORE_DOC_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (res.status === 429) {
      isFirestoreQuotaExhausted = true;
      lastQuotaCheckTime = now;
      return null;
    }
    if (res.status === 404 || !res.ok) return null;
    isFirestoreQuotaExhausted = false;
    return decodeDoc(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isSameWorkerOrigin(requestUrl) {
  try {
    return new URL(requestUrl).origin === new URL(WORKER_RELAY_BASE).origin;
  } catch {
    return false;
  }
}

async function fetchFromWorkerRelay(requestUrl) {
  if (isSameWorkerOrigin(requestUrl)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(`${WORKER_RELAY_BASE}/api/sync?_t=${Date.now()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json && json.exists && json.data) {
      return json.data;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshLatestFromBackends(db, requestUrl, { allowUpstream = true } = {}) {
  let d1State = null;
  let d1Connected = false;

  if (db) {
    try {
      d1State = await readStateFromD1(db);
      d1Connected = true;
    } catch (err) {
      console.error('[Pages D1] Read error:', err);
    }
  }

  let best = memoryCache;
  if (isCandidateNewer(d1State, best)) {
    best = d1State;
  }

  const now = Date.now();
  const shouldProbeUpstream = allowUpstream && (!best || now - lastUpstreamCheckTime > UPSTREAM_TTL_MS);

  if (shouldProbeUpstream) {
    lastUpstreamCheckTime = now;
    const [fsData, workerData] = await Promise.all([
      fetchFromFirestore(),
      fetchFromWorkerRelay(requestUrl),
    ]);

    const applyIfValidNewer = (cand) => {
      if (!cand || !isCandidateNewer(cand, best)) return false;
      const wouldRegressLegacy =
        best?.schedule &&
        getSchedHash(best.schedule) !== LEGACY_STALE_SCHEDULE_HASH &&
        Array.isArray(cand.schedule) &&
        getSchedHash(cand.schedule) === LEGACY_STALE_SCHEDULE_HASH &&
        !cand._explicitReset;
      if (wouldRegressLegacy) return false;
      best = cand;
      return true;
    };

    const fsWon = applyIfValidNewer(fsData);
    const workerWon = applyIfValidNewer(workerData);

    if (db && best && (!d1State || fsWon || workerWon)) {
      try {
        await writeStateToD1(db, best, {
          event: d1State ? 'd1_sync_from_upstream' : 'd1_seed_from_upstream',
          origin: workerWon ? 'worker-relay' : 'firestore-sync',
        });
        d1Connected = true;
      } catch {}
    }
  }

  if (best) {
    memoryCache = best;
  }

  return { state: best, d1Connected };
}

async function writeToFirestore(data, merge = true) {
  const now = Date.now();
  if (isFirestoreQuotaExhausted && now - lastQuotaCheckTime < 3600000) return false;
  let url = FIRESTORE_DOC_URL;
  if (merge) {
    const mask = Object.keys(data)
      .filter((k) => data[k] !== undefined)
      .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
      .join('&');
    if (mask) url += `?${mask}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encodeDoc(data)),
      signal: controller.signal,
    });
    if (res.status === 429) {
      isFirestoreQuotaExhausted = true;
      lastQuotaCheckTime = now;
      return false;
    }
    if (!res.ok) return false;
    isFirestoreQuotaExhausted = false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function writeToWorkerRelay(data, requestUrl, isReset = false, clientId = 'pages_proxy', env = {}) {
  if (isSameWorkerOrigin(requestUrl)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const target = `${WORKER_RELAY_BASE}/api/sync${isReset ? '/reset' : ''}`;
    const headers = { 'Content-Type': 'application/json' };
    if (env?.SYNC_WRITE_SECRET) {
      headers['X-ShiftFlow-Secret'] = env.SYNC_WRITE_SECRET;
    }
    const res = await fetch(target, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: isReset ? { ...data, _explicitReset: true } : data,
        clientId,
        forceOverwrite: true,
      }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const db = resolveD1Binding(env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const action = url.searchParams.get('action');
  const isHealth = url.pathname.includes('/health') || action === 'health';
  const isAudit = url.pathname.includes('/audit') || action === 'audit';
  const isSnapshots = url.pathname.includes('/snapshots') || action === 'snapshots' || action === 'create-snapshot';
  const isRestore = url.pathname.includes('/restore') || action === 'restore';
  const isReset = url.pathname.includes('/reset') || action === 'reset';
  const isStream =
    url.pathname.includes('/stream') || request.headers.get('accept') === 'text/event-stream';

  if (isHealth && request.method === 'GET') {
    let d1Connected = false;
    let d1State = null;
    let snapshotsCount = 0;
    if (db) {
      try {
        d1State = await readStateFromD1(db);
        snapshotsCount = await countSnapshotsInD1(db);
        d1Connected = true;
      } catch {}
    }
    const active = d1State || memoryCache;
    return jsonResponse({
      status: 'ok',
      platform: 'cloudflare-pages-function',
      storageEngine: db ? 'cloudflare-d1' : 'relay+firestore',
      d1Bound: Boolean(db),
      d1Connected,
      writeProtected: Boolean(env?.SYNC_WRITE_SECRET),
      snapshotsCount,
      firestoreQuotaExhausted: isFirestoreQuotaExhausted,
      directRest: true,
      cachedItems: active && Array.isArray(active.schedule) ? active.schedule.length : 0,
      version: active?._version || 0,
      revision: active?._revision || 0,
      updatedAt: active?.updatedAt || null,
      serverTime: new Date().toISOString(),
    });
  }

  if (isAudit && request.method === 'GET') {
    const limit = url.searchParams.get('limit') || '50';
    const logs = db ? await readAuditFromD1(db, limit) : [];
    return jsonResponse({
      storageEngine: db ? 'cloudflare-d1' : 'relay+firestore',
      d1Bound: Boolean(db),
      count: logs.length,
      audit: logs,
    });
  }

  if (isSnapshots && request.method === 'GET') {
    if (db) {
      const limit = url.searchParams.get('limit') || '25';
      const snapshots = await listSnapshotsFromD1(db, limit);
      return jsonResponse({
        storageEngine: 'cloudflare-d1',
        d1Bound: true,
        count: snapshots.length,
        snapshots,
      });
    }
    // Proxy cleanly to Worker relay when Pages D1 is not directly bound
    if (!isSameWorkerOrigin(request.url)) {
      try {
        const res = await fetch(`${WORKER_RELAY_BASE}/api/sync/snapshots`);
        if (res.ok) {
          return jsonResponse(await res.json(), 200);
        }
      } catch {}
    }
    return jsonResponse({ storageEngine: 'relay+firestore', d1Bound: false, count: 0, snapshots: [] });
  }

  if (isStream && request.method === 'GET') {
    const { state } = await refreshLatestFromBackends(db, request.url, { allowUpstream: true });
    return new Response(
      `data: ${JSON.stringify({ type: 'init', data: state || null, version: state?._version || 1 })}\n\n`,
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
        },
      }
    );
  }

  if (request.method === 'GET') {
    const clientSince = url.searchParams.get('since');
    const forceRefresh = url.searchParams.get('refresh') === '1';

    const { state, d1Connected } = await refreshLatestFromBackends(db, request.url, {
      allowUpstream: forceRefresh || !memoryCache,
    });

    if (state) {
      const updatedAt = state.updatedAt || '';
      const ver = typeof state._version === 'number' ? state._version : 1;
      if (clientSince && updatedAt && updatedAt === clientSince) {
        return jsonResponse({
          exists: true,
          modified: false,
          version: ver,
          updatedAt,
          storageEngine: db ? 'cloudflare-d1' : 'relay+firestore',
          d1Connected,
        });
      }
      return jsonResponse({
        exists: true,
        modified: true,
        version: ver,
        updatedAt,
        storageEngine: db ? 'cloudflare-d1' : 'relay+firestore',
        d1Connected,
        data: state,
      });
    }

    return jsonResponse({
      exists: false,
      storageEngine: db ? 'cloudflare-d1' : 'relay+firestore',
      d1Connected,
      data: null,
    });
  }

  if (request.method === 'POST') {
    if (!isAuthorizedWrite(request, env)) {
      return jsonResponse({ success: false, error: 'Unauthorized write token' }, 401);
    }

    let body = {};
    try {
      body = await request.json();
    } catch {}

    // Manual Snapshot Creation
    if (isSnapshots) {
      if (db) {
        const { state } = await refreshLatestFromBackends(db, request.url, { allowUpstream: false });
        if (!state) {
          return jsonResponse({ success: false, error: 'No active roster state available to snapshot' }, 404);
        }
        const label = typeof body?.label === 'string' ? body.label.trim().slice(0, 80) : '';
        const snapshot = await createSnapshotInD1(db, state, {
          type: 'manual',
          label: label || 'اسنپ‌شات دستی',
        });
        return jsonResponse({ success: true, snapshot }, 200);
      }
      if (!isSameWorkerOrigin(request.url)) {
        try {
          const res = await fetch(`${WORKER_RELAY_BASE}/api/sync/snapshots`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(env?.SYNC_WRITE_SECRET ? { 'X-ShiftFlow-Secret': env.SYNC_WRITE_SECRET } : {}),
            },
            body: JSON.stringify(body),
          });
          if (res.ok) return jsonResponse(await res.json(), 200);
        } catch {}
      }
      return jsonResponse({ success: false, error: 'D1 not bound for snapshot creation' }, 501);
    }

    // Restore from Snapshot
    if (isRestore) {
      if (db) {
        const snapshotId = body?.snapshotId || url.searchParams.get('id');
        if (!snapshotId) {
          return jsonResponse({ success: false, error: 'snapshotId is required' }, 400);
        }
        const found = await getSnapshotPayloadFromD1(db, snapshotId);
        if (!found) {
          return jsonResponse({ success: false, error: 'Snapshot not found' }, 404);
        }

        const { state: currentState } = await refreshLatestFromBackends(db, request.url, { allowUpstream: false });
        if (currentState) {
          await createSnapshotInD1(db, currentState, {
            type: 'pre_restore',
            label: `پشتیبان ایمنی پیش از بازگشت به #${found.meta.id}`,
            skipIfIdentical: true,
          });
        }

        const clientId = (body && body.clientId) || 'snapshot_restore';
        const now = nextMonotonicTimestamp(currentState?.updatedAt, found.payload?.updatedAt);
        const nextVersion =
          Math.max(
            typeof currentState?._version === 'number' ? currentState._version : 0,
            typeof found.payload?._version === 'number' ? found.payload._version : 0
          ) + 1;
        const nextRevision =
          Math.max(
            typeof currentState?._revision === 'number' ? currentState._revision : 0,
            typeof found.payload?._revision === 'number' ? found.payload._revision : 0
          ) + 1;

        const restoredPayload = {
          ...found.payload,
          updatedAt: now,
          _version: nextVersion,
          _revision: nextRevision,
          _originClientId: clientId,
          _explicitReset: true,
        };

        memoryCache = restoredPayload;
        const d1Persisted = await writeStateToD1(db, restoredPayload, {
          event: 'restore',
          clientId,
          origin: 'cloudflare-pages-function',
          details: { snapshotId: found.meta.id, snapshotLabel: found.meta.label },
        });

        await Promise.all([
          writeToFirestore(restoredPayload, false),
          writeToWorkerRelay(restoredPayload, request.url, true, clientId, env),
        ]);

        return jsonResponse({
          success: true,
          d1Persisted,
          restoredSnapshotId: found.meta.id,
          version: nextVersion,
          revision: nextRevision,
          updatedAt: now,
          data: restoredPayload,
        });
      }
      if (!isSameWorkerOrigin(request.url)) {
        try {
          const res = await fetch(`${WORKER_RELAY_BASE}/api/sync/restore`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(env?.SYNC_WRITE_SECRET ? { 'X-ShiftFlow-Secret': env.SYNC_WRITE_SECRET } : {}),
            },
            body: JSON.stringify(body),
          });
          if (res.ok) return jsonResponse(await res.json(), 200);
        } catch {}
      }
      return jsonResponse({ success: false, error: 'D1 not bound for restore' }, 501);
    }

    const incoming = (body && body.data) || body || {};
    const clientId = (body && body.clientId) || incoming?._originClientId || 'pages_client';

    const loaded = await refreshLatestFromBackends(db, request.url, { allowUpstream: false });
    const baseState = isReset ? null : loaded.state;

    // Auto safety snapshot before explicit reset
    if (isReset && db && loaded.state) {
      try {
        await createSnapshotInD1(db, loaded.state, {
          type: 'pre_reset',
          label: 'بکاپ ایمنی پیش از ریست',
          skipIfIdentical: true,
        });
      } catch {}
    }

    // Only block legacy 88aedc2d fallback overwrites unless explicit reset
    if (
      !isReset &&
      !(body && body.forceOverwrite) &&
      !incoming?._explicitReset &&
      baseState?.schedule &&
      getSchedHash(baseState.schedule) !== LEGACY_STALE_SCHEDULE_HASH &&
      Array.isArray(incoming?.schedule) &&
      getSchedHash(incoming.schedule) === LEGACY_STALE_SCHEDULE_HASH
    ) {
      return jsonResponse(
        {
          success: false,
          error: 'stale_conflict',
          updatedAt: baseState.updatedAt,
          data: baseState,
        },
        409
      );
    }

    const now = nextMonotonicTimestamp(baseState?.updatedAt, incoming?.updatedAt);
    const nextVersion =
      Math.max(
        typeof baseState?._version === 'number' ? baseState._version : 0,
        typeof incoming?._version === 'number' ? incoming._version : 0
      ) + 1;
    const nextRevision =
      Math.max(
        typeof baseState?._revision === 'number' ? baseState._revision : 0,
        typeof incoming?._revision === 'number' ? incoming._revision : 0
      ) + 1;

    const firestorePatch = {
      ...incoming,
      updatedAt: now,
      _version: nextVersion,
      _revision: nextRevision,
      ...(clientId ? { _originClientId: clientId } : {}),
      ...(isReset ? { _explicitReset: true } : {}),
    };
    const payload = {
      ...(isReset ? {} : baseState || {}),
      ...firestorePatch,
    };

    if (isReset || Array.isArray(payload.schedule)) {
      memoryCache = payload;
    }

    let d1Persisted = false;
    if (db) {
      try {
        d1Persisted = await writeStateToD1(db, payload, {
          event: isReset ? 'reset' : 'post',
          clientId,
          origin: 'cloudflare-pages-function',
          details: { forceOverwrite: Boolean(body?.forceOverwrite) },
        });
      } catch (err) {
        console.error('[Pages D1] Write failed:', err);
      }
    }

    const [firestorePersisted, workerPersisted] = await Promise.all([
      writeToFirestore(isReset ? payload : firestorePatch, !isReset),
      writeToWorkerRelay(payload, request.url, isReset, clientId || 'pages_proxy', env),
    ]);

    if (!d1Persisted && !firestorePersisted && !workerPersisted) {
      return jsonResponse(
        { success: false, error: 'All cloud persistence backends failed' },
        502
      );
    }

    return jsonResponse({
      success: true,
      storageEngine: db ? 'cloudflare-d1' : 'relay+firestore',
      d1Persisted,
      firestorePersisted,
      workerPersisted,
      version: nextVersion,
      revision: nextRevision,
      updatedAt: now,
      data: payload,
    });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}
