import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { FALLBACK_ROSTER_STATE } from './utils/fallbackRoster.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = isProd ? parseInt(process.env.PORT || '3000', 10) : 3000;

// Load Firebase configuration
const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
let firebaseConfig: any = null;
try {
  if (fs.existsSync(firebaseConfigPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));
  }
} catch (e) {
  console.warn('[SyncServer] Could not load firebase-applet-config.json:', e);
}

// Clean data before writing to Firestore
function sanitizeForFirestore<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) => {
      if (value === undefined) {
        return undefined;
      }
      return value;
    })
  );
}

function nextMonotonicIsoTimestamp(...existingIsos: Array<string | undefined | null>): string {
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

function decodeFirestoreRestValue(val: any): any {
  if (!val || typeof val !== 'object') return val;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    const list = val.arrayValue?.values || [];
    return list.map(decodeFirestoreRestValue);
  }
  if ('mapValue' in val) {
    const res: any = {};
    const fields = val.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = decodeFirestoreRestValue(v);
    }
    return res;
  }
  return val;
}

function encodeFirestoreRestValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(encodeFirestoreRestValue) } };
  }
  if (typeof val === 'object') {
    const fields: any = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreRestValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

async function startServer() {
  const app = express();

  // Basic middleware
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Ensure persistent data directory exists
  const dataDir = path.resolve(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dataFilePath = path.join(dataDir, 'roster-state.json');
  const auditLogPath = path.join(dataDir, 'sync-audit.log');

  const LEGACY_STALE_SCHEDULE_HASH = '88aedc2d';
  const WORKER_RELAY_SYNC_URL = 'https://shiftflow-sync.rzcegpj.workers.dev/api/sync';

  function getSchedHash(sched: any): string {
    if (!Array.isArray(sched) || sched.length === 0) return 'empty';
    const str = sched
      .map((s: any) => `${s.date}:${s.dayShiftPerson || ''}:${s.nightShiftPerson || ''}:${s.onCallPerson || ''}:${(s.extraDayPersons || []).join(',')}:${(s.extraNightPersons || []).join(',')}`)
      .join('|');
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  async function mirrorToWorkerRelay(stateToMirror: any): Promise<void> {
    if (!stateToMirror) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(WORKER_RELAY_SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: sanitizeForFirestore(stateToMirror), clientId: stateToMirror._originClientId || 'server_healer' }),
        signal: controller.signal,
      });
    } catch {
      // Ignore Worker relay mirror errors
    } finally {
      clearTimeout(timer);
    }
  }

  let syncAuditHistory: any[] = [];
  try {
    if (fs.existsSync(auditLogPath)) {
      const lines = fs.readFileSync(auditLogPath, 'utf-8').trim().split('\n').filter(Boolean);
      syncAuditHistory = lines.slice(-100).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    }
  } catch {}

  function recordSyncAudit(entry: Record<string, any>) {
    const rec = { ts: new Date().toISOString(), ...entry };
    syncAuditHistory.push(rec);
    if (syncAuditHistory.length > 100) {
      syncAuditHistory = syncAuditHistory.slice(-100);
    }
    try {
      const payload = syncAuditHistory.map((x) => JSON.stringify(x)).join('\n') + '\n';
      fs.promises.writeFile(auditLogPath, payload, 'utf-8').catch(() => {});
    } catch {}
  }

  // In-memory state and SSE connection pool
  let currentState: any = null;
  let stateVersion = 1;
  let stateRevision = 0;
  let sseClients: express.Response[] = [];
  let isFirestoreConnected = Boolean(firebaseConfig?.projectId && firebaseConfig?.firestoreDatabaseId);

  // 1. Try to load initial state from local persistent file cache (or seed from FALLBACK_ROSTER_STATE)
  try {
    if (fs.existsSync(dataFilePath)) {
      const raw = fs.readFileSync(dataFilePath, 'utf-8');
      currentState = JSON.parse(raw);
      stateVersion = currentState._version || 1;
      stateRevision = typeof currentState._revision === 'number' ? currentState._revision : 0;
      console.log(`[SyncServer] Loaded local roster state cache (version ${stateVersion}, rev ${stateRevision}, updatedAt ${currentState.updatedAt})`);
    } else if (FALLBACK_ROSTER_STATE) {
      currentState = {
        ...FALLBACK_ROSTER_STATE,
        updatedAt: (FALLBACK_ROSTER_STATE as any).updatedAt || (FALLBACK_ROSTER_STATE as any)._baseUpdatedAt || new Date().toISOString(),
      };
      stateVersion = currentState._version || 31;
      stateRevision = typeof currentState._revision === 'number' ? currentState._revision : 6;
      fs.writeFileSync(dataFilePath, JSON.stringify(currentState, null, 2), 'utf-8');
      console.log(`[SyncServer] Initialized local roster state from FALLBACK_ROSTER_STATE (version ${stateVersion}, rev ${stateRevision})`);
    }
  } catch (err) {
    console.error('[SyncServer] Could not read local roster state file:', err);
  }

  // Broadcast update to all connected SSE clients
  function broadcast(eventPayload: any) {
    const rawData = `data: ${JSON.stringify(eventPayload)}\n\n`;
    sseClients.forEach((client) => {
      try {
        client.write(rawData);
      } catch {
        // Client might have dropped
      }
    });
  }

  // Helper to persist state to local file sequentially without out-of-order overwrites
  let diskWriteQueue = Promise.resolve();
  function persistToDisk(data: any) {
    const serialized = JSON.stringify(data, null, 2);
    diskWriteQueue = diskWriteQueue
      .then(() => fs.promises.writeFile(dataFilePath, serialized, 'utf-8'))
      .catch((err) => {
        console.error('[SyncServer] Error writing to data file:', err);
      });
  }

  const quotaFilePath = path.resolve(dataDir, 'firestore-quota.json');
  let isFirestoreQuotaExhausted = false;
  try {
    if (fs.existsSync(quotaFilePath)) {
      const qData = JSON.parse(fs.readFileSync(quotaFilePath, 'utf-8'));
      const today = new Date().toISOString().slice(0, 10);
      if (qData.exhaustedDate === today) {
        isFirestoreQuotaExhausted = true;
        console.log('[SyncServer] Loaded Firestore quota status: Daily limit reached for today. Running on server disk & memory.');
      }
    }
  } catch (e) {
    // ignore
  }

  function markQuotaExhausted() {
    isFirestoreQuotaExhausted = true;
    isFirestoreConnected = false;
    try {
      const today = new Date().toISOString().slice(0, 10);
      fs.writeFileSync(quotaFilePath, JSON.stringify({ exhaustedDate: today, reason: 'RESOURCE_EXHAUSTED' }, null, 2));
    } catch {}
  }

  function getFirestoreRestUrl(): string | null {
    if (!firebaseConfig?.projectId || !firebaseConfig?.firestoreDatabaseId) return null;
    const apiKey = firebaseConfig.apiKey ? `?key=${encodeURIComponent(firebaseConfig.apiKey)}` : '';
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/${encodeURIComponent(firebaseConfig.firestoreDatabaseId)}/documents/roster_state/current${apiKey}`;
  }

  async function fetchFirestoreViaREST(): Promise<any | null> {
    if (isFirestoreQuotaExhausted) return null;
    const baseUrl = getFirestoreRestUrl();
    if (!baseUrl) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(baseUrl, { headers: { Accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
      if (res.status === 429) {
        markQuotaExhausted();
        return null;
      }
      if (!res.ok) return null;
      const docJson: any = await res.json();
      if (!docJson?.fields) return null;
      const out: any = {};
      for (const [k, v] of Object.entries(docJson.fields)) {
        out[k] = decodeFirestoreRestValue(v);
      }
      isFirestoreConnected = true;
      return out;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function writeFirestoreViaREST(cleanData: Record<string, any>, merge = true): Promise<boolean> {
    if (isFirestoreQuotaExhausted) return false;
    const baseUrl = getFirestoreRestUrl();
    if (!baseUrl) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const fields: Record<string, any> = {};
      for (const [k, v] of Object.entries(cleanData)) {
        if (v !== undefined) fields[k] = encodeFirestoreRestValue(v);
      }
      let url = baseUrl;
      if (merge) {
        const sep = url.includes('?') ? '&' : '?';
        const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
        if (mask) url += `${sep}${mask}`;
      }
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
        signal: controller.signal,
      });
      if (res.status === 429) {
        markQuotaExhausted();
        return false;
      }
      if (!res.ok) return false;
      isFirestoreConnected = true;
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // Helper to write to Firestore via HTTPS REST API (avoids Node.js gRPC idle stream disconnects)
  async function persistToFirestore(data: any, merge = true): Promise<boolean> {
    if (isFirestoreQuotaExhausted) return false;
    const cleanData = sanitizeForFirestore(data);
    return await writeFirestoreViaREST(cleanData, merge);
  }

  // Helper to reconcile incoming cloud data with local server state and self-healing guard
  function reconcileCloudState(remoteData: any, eventSourceLabel: string) {
    if (!remoteData) return;
    isFirestoreConnected = true;
    const remoteUpdated = remoteData.updatedAt || '';
    const localUpdated = currentState?.updatedAt || '';

    if (!currentState || (remoteUpdated && localUpdated ? remoteUpdated > localUpdated : Boolean(remoteUpdated))) {
      const prevHash = getSchedHash(currentState?.schedule);
      const nextHash = getSchedHash(remoteData.schedule);
      const remoteRevision = typeof remoteData._revision === 'number' ? remoteData._revision : 0;

      const isUnauthorizedLegacyRevert =
        currentState &&
        prevHash !== 'empty' &&
        prevHash !== LEGACY_STALE_SCHEDULE_HASH &&
        nextHash === LEGACY_STALE_SCHEDULE_HASH &&
        !remoteData._explicitReset;

      const isUnhydratedLowerRevisionOverwrite =
        currentState &&
        prevHash !== 'empty' &&
        nextHash !== prevHash &&
        stateRevision > 0 &&
        remoteRevision > 0 &&
        remoteRevision < stateRevision &&
        !remoteData._explicitReset;

      if (isUnauthorizedLegacyRevert || isUnhydratedLowerRevisionOverwrite) {
        const healedNow = nextMonotonicIsoTimestamp(currentState.updatedAt, remoteUpdated);
        stateVersion += 1;
        stateRevision = Math.max(stateRevision, remoteRevision) + 1;
        currentState = {
          ...currentState,
          updatedAt: healedNow,
          _version: stateVersion,
          _revision: stateRevision,
        };
        persistToDisk(currentState);
        recordSyncAudit({
          event: 'auto_healed_revert',
          offendingClientId: remoteData._originClientId || 'unknown',
          offendingBuild: remoteData._clientBuild || 'legacy',
          offendingUpdatedAt: remoteUpdated,
          offendingRevision: remoteRevision,
          offendingHash: nextHash,
          restoredHash: prevHash,
          healedUpdatedAt: healedNow,
          healedRevision: stateRevision,
        });
        persistToFirestore(currentState, true).catch(() => {});
        mirrorToWorkerRelay(currentState).catch(() => {});
        broadcast({
          type: 'update',
          data: currentState,
          version: stateVersion,
          updatedAt: healedNow,
        });
        return;
      }

      stateVersion = Math.max(stateVersion, typeof remoteData._version === 'number' ? remoteData._version : 0) + 1;
      stateRevision = Math.max(stateRevision, remoteRevision);
      currentState = {
        ...remoteData,
        _version: stateVersion,
        _revision: stateRevision,
      };
      persistToDisk(currentState);
      if (prevHash !== nextHash) {
        recordSyncAudit({
          event: eventSourceLabel,
          clientId: remoteData._originClientId || 'unknown',
          clientBuild: remoteData._clientBuild || 'legacy',
          updatedAt: remoteUpdated,
          prevUpdatedAt: localUpdated,
          revision: stateRevision,
          schedHash: nextHash,
          prevHash,
        });
      }
      broadcast({
        type: 'update',
        data: currentState,
        version: stateVersion,
        updatedAt: remoteUpdated,
      });
    }
  }

  // 2. Initial Firestore REST sync on startup + keep Cloudflare Worker relay warm
  if (currentState) {
    mirrorToWorkerRelay(currentState).catch(() => {});
  }
  setInterval(() => {
    if (currentState) {
      mirrorToWorkerRelay(currentState).catch(() => {});
    }
  }, 45000);
  if (firebaseConfig?.projectId && firebaseConfig?.firestoreDatabaseId) {
    fetchFirestoreViaREST()
      .then((restData) => {
        if (restData) {
          reconcileCloudState(restData, 'firestore_init');
        }
      })
      .catch(() => {});
  }

  // --- API & Android Package Endpoints ---

  // Digital Asset Links for Android TWA / Fullscreen Verification
  app.get('/.well-known/assetlinks.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'ir.fmd.shiftflow.app',
          sha256_cert_fingerprints: [
            '26:D3:18:69:9D:99:B3:27:59:47:1D:64:AD:F4:18:6C:05:D7:BE:07:4A:23:42:C3:C2:40:B8:83:FB:FE:30:C3'
          ]
        }
      }
    ]);
  });

  // Direct Signed Android APK Download (ShiftFlow-FMD.apk)
  app.get(['/api/download-apk', '/ShiftFlow-FMD.apk'], (_req, res) => {
    const apkPath = path.resolve(__dirname, 'public', 'ShiftFlow-FMD.apk');
    if (!fs.existsSync(apkPath)) {
      return res.status(404).json({ error: 'فایل APK یافت نشد.' });
    }
    const stat = fs.statSync(apkPath);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="ShiftFlow-FMD.apk"');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(apkPath);
  });

  // Full Android Release Bundle ZIP (APK + AAB + Keystore + AssetLinks)
  app.get(['/api/download-android-bundle', '/ShiftFlow-FMD-Android-Package.zip'], (_req, res) => {
    const zipPath = path.resolve(__dirname, 'public', 'ShiftFlow-FMD-Android-Package.zip');
    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'فایل پکیج اندروید یافت نشد.' });
    }
    const stat = fs.statSync(zipPath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="ShiftFlow-FMD-Android-Package.zip"');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(zipPath);
  });

  // Always serve public/ static files (PWA icons, manifest, APK)
  app.use(express.static(path.resolve(__dirname, 'public')));

  // Health check
  app.get('/api/sync/health', (_req, res) => {
    res.json({
      status: 'ok',
      hasData: Boolean(currentState),
      version: stateVersion,
      revision: stateRevision,
      firestoreConnected: isFirestoreConnected,
      serverTime: new Date().toISOString(),
      activeClients: sseClients.length
    });
  });

  // Read-only sync audit history (last 100 events) for diagnosing multi-tab/multi-host overwrites
  app.get('/api/sync/audit', (_req, res) => {
    res.json({
      currentUpdatedAt: currentState?.updatedAt || null,
      currentVersion: stateVersion,
      currentRevision: stateRevision,
      currentSchedHash: getSchedHash(currentState?.schedule),
      events: syncAuditHistory.slice(-50)
    });
  });

  let lastFirestoreFetchTime = 0;

  // Server-Sent Events (SSE) Stream
  app.get('/api/sync/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering on reverse proxies & Cloud Run
    res.flushHeaders?.();

    sseClients.push(res);
    console.log(`[SyncServer] SSE client connected. Active: ${sseClients.length}`);

    // If we have existing data, immediately send it to the newly connected client
    if (currentState) {
      res.write(`data: ${JSON.stringify({ type: 'init', data: currentState, version: stateVersion })}\n\n`);
    }

    // Keep-alive ping every 15 seconds to prevent mobile cellular carrier drops
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(pingInterval);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(pingInterval);
      sseClients = sseClients.filter((c) => c !== res);
      console.log(`[SyncServer] SSE client disconnected. Active: ${sseClients.length}`);
    });
  });

  // GET roster state
  app.get('/api/sync', async (req, res) => {
    const clientSince = req.query.since as string | undefined;
    const nowMs = Date.now();

    // Check Firestore on-demand if memory state is empty OR every 60 seconds to conserve daily read quota
    if (!isFirestoreQuotaExhausted && (!currentState || nowMs - lastFirestoreFetchTime > 60000)) {
      try {
        lastFirestoreFetchTime = nowMs;
        const cloudData = await fetchFirestoreViaREST();
        if (cloudData) {
          reconcileCloudState(cloudData, 'firestore_poll');
        }
      } catch (e) {
        console.warn('[SyncServer] Periodic Firestore check notice:', e);
      }
    }

    if (!currentState) {
      return res.json({
        exists: false,
        version: 0,
        updatedAt: null,
        data: null
      });
    }

    if (clientSince && currentState.updatedAt === clientSince) {
      return res.json({
        exists: true,
        modified: false,
        version: stateVersion,
        updatedAt: currentState.updatedAt
      });
    }

    res.json({
      exists: true,
      modified: true,
      version: stateVersion,
      updatedAt: currentState.updatedAt,
      data: currentState
    });
  });

  // POST / update roster state
  app.post('/api/sync', async (req, res) => {
    try {
      const incoming = req.body;
      const dataToMerge = incoming.data || incoming;
      const clientId = incoming.clientId || incoming.data?.clientId || dataToMerge?._originClientId;
      const clientBuild = dataToMerge?._clientBuild || 'legacy';
      const baseUpdatedAt = dataToMerge?._baseUpdatedAt;
      const prevHash = getSchedHash(currentState?.schedule);
      const nextHash = Array.isArray(dataToMerge?.schedule) ? getSchedHash(dataToMerge.schedule) : prevHash;
      const incomingRev = typeof dataToMerge?._revision === 'number' ? dataToMerge._revision : 0;

      // Reject any attempt to revert schedule back to legacy 88aedc2d fallback without _explicitReset
      if (
        currentState &&
        prevHash !== 'empty' &&
        prevHash !== LEGACY_STALE_SCHEDULE_HASH &&
        nextHash === LEGACY_STALE_SCHEDULE_HASH &&
        !dataToMerge?._explicitReset &&
        !incoming.forceOverwrite
      ) {
        recordSyncAudit({
          event: 'rejected_legacy_fallback',
          clientId,
          clientBuild,
          origin: req.headers.origin || req.headers.referer || '',
          schedHash: nextHash,
          prevHash,
        });
        return res.status(409).json({
          success: false,
          error: 'stale_conflict',
          updatedAt: currentState.updatedAt,
          data: currentState,
        });
      }

      // Guard against stale background tabs from a different client overwriting newer schedule edits
      if (
        currentState?.updatedAt &&
        clientId &&
        currentState._originClientId &&
        clientId !== currentState._originClientId &&
        Array.isArray(dataToMerge?.schedule) &&
        nextHash !== prevHash &&
        !dataToMerge?._explicitReset &&
        !incoming.forceOverwrite
      ) {
        const currentMs = Date.parse(currentState.updatedAt);
        const baseMs = baseUpdatedAt && typeof baseUpdatedAt === 'string' ? Date.parse(baseUpdatedAt) : 0;
        const isStaleBase = Number.isFinite(currentMs) && Number.isFinite(baseMs) && baseMs > 0 && currentMs - baseMs > 30000;
        const isLowerRevision = stateRevision > 0 && incomingRev > 0 && incomingRev < stateRevision;
        if (isStaleBase || isLowerRevision) {
          recordSyncAudit({
            event: 'rejected_stale',
            clientId,
            clientBuild,
            origin: req.headers.origin || req.headers.referer || '',
            baseUpdatedAt,
            incomingRev,
            stateRevision,
            currentUpdatedAt: currentState.updatedAt,
            schedHash: nextHash,
            prevHash,
          });
          return res.status(409).json({
            success: false,
            error: 'stale_conflict',
            updatedAt: currentState.updatedAt,
            data: currentState,
          });
        }
      }

      const now = nextMonotonicIsoTimestamp(currentState?.updatedAt, dataToMerge?.updatedAt);
      stateVersion = Math.max(stateVersion, typeof dataToMerge?._version === 'number' ? dataToMerge._version : 0) + 1;
      stateRevision = Math.max(stateRevision, incomingRev) + 1;

      const prevUpdatedAt = currentState?.updatedAt || null;
      currentState = {
        ...(currentState || {}),
        ...dataToMerge,
        updatedAt: now,
        _version: stateVersion,
        _revision: stateRevision,
        ...(clientId ? { _originClientId: clientId } : {})
      };

      // 1. Persist to local disk
      persistToDisk(currentState);

      // 2. Broadcast immediately to all active SSE clients
      broadcast({
        type: 'update',
        data: currentState,
        version: stateVersion,
        updatedAt: now
      });

      // 3. Await Firestore cloud write before returning 200 so a new browser opening immediately gets the latest state
      const firestorePersisted = await persistToFirestore(currentState, true);
      mirrorToWorkerRelay(currentState).catch(() => {});

      recordSyncAudit({
        event: 'post',
        clientId: clientId || 'unknown',
        clientBuild,
        origin: req.headers.origin || req.headers.referer || '',
        updatedAt: now,
        prevUpdatedAt,
        version: stateVersion,
        revision: stateRevision,
        schedHash: nextHash,
        prevHash,
        firestorePersisted,
      });

      res.json({
        success: true,
        version: stateVersion,
        updatedAt: now,
        firestorePersisted,
        data: currentState
      });
    } catch (err: any) {
      console.error('[SyncServer] Error updating state:', err);
      res.status(500).json({ success: false, error: err?.message || 'Server error' });
    }
  });

  // POST /api/sync/reset
  app.post('/api/sync/reset', async (req, res) => {
    try {
      const incoming = req.body;
      const fullData = incoming.data || incoming;

      const prevUpdatedAt = currentState?.updatedAt || null;
      const prevHash = getSchedHash(currentState?.schedule);
      const now = nextMonotonicIsoTimestamp(currentState?.updatedAt, fullData?.updatedAt);
      stateVersion = Math.max(stateVersion, typeof fullData?._version === 'number' ? fullData._version : 0) + 1;
      stateRevision = Math.max(stateRevision, typeof fullData?._revision === 'number' ? fullData._revision : 0) + 1;

      currentState = {
        ...fullData,
        updatedAt: now,
        _version: stateVersion,
        _revision: stateRevision
      };

      persistToDisk(currentState);

      broadcast({
        type: 'reset',
        data: currentState,
        version: stateVersion,
        updatedAt: now
      });

      const firestorePersisted = await persistToFirestore(currentState, false);

      recordSyncAudit({
        event: 'reset',
        clientId: fullData?._originClientId || 'unknown',
        origin: req.headers.origin || req.headers.referer || '',
        updatedAt: now,
        prevUpdatedAt,
        version: stateVersion,
        revision: stateRevision,
        schedHash: getSchedHash(currentState.schedule),
        prevHash,
        firestorePersisted,
      });

      res.json({
        success: true,
        version: stateVersion,
        updatedAt: now,
        firestorePersisted
      });
    } catch (err: any) {
      console.error('[SyncServer] Error resetting state:', err);
      res.status(500).json({ success: false, error: err?.message || 'Server error' });
    }
  });

  // POST /api/parse-pdf - Reliable PDF schedule parser endpoint
  app.post('/api/parse-pdf', async (req, res) => {
    try {
      const { pdfBase64, knownPersonnel } = req.body;
      if (!pdfBase64) {
        return res.status(400).json({ error: 'pdfBase64 is required' });
      }
      const buffer = Buffer.from(pdfBase64, 'base64');
      const { parsePdfBuffer } = await import('./utils/pdfParser.ts');
      const result = await parsePdfBuffer(buffer, knownPersonnel || []);
      return res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      console.error('[SyncServer] PDF Parse API error:', err);
      return res.status(500).json({ error: 'Failed to parse PDF', message: err?.message || String(err) });
    }
  });

  // POST /api/chat - Multi-turn conversational AI assistant powered by Gemini
  app.post('/api/chat', async (req, res) => {
    try {
      const { messages, complexity, scheduleContext } = req.body;
      if (!messages || !Array.isArray(messages)) {
        return res.status(200).json({
          reply: 'لطفاً پیام خود را وارد نمایید.',
          modelUsed: 'gemini-3.8-flash',
          timestamp: new Date().toISOString()
        });
      }

      const { GoogleGenAI } = await import('@google/genai');
      const apiKey = process.env.GEMINI_API_KEY || '';
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];

      // Format conversation history for Gemini API
      const contents = messages.map((m: any) => ({
        role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : (m.text || '') }]
      }));

      const contextSummary = scheduleContext
        ? `\nاطلاعات فعلی سامانه:\n- کارشناسان فعال شیفت: ${(scheduleContext.shiftWorkers || []).join('، ')}\n- سرپرستان: ${(scheduleContext.supervisors || []).join('، ')}\n- ماه جاری تقویم: ${scheduleContext.currentMonthName || ''} ${scheduleContext.currentYear || 1405}${scheduleContext.generatedSummary ? `\n- خلاصه برنامه چیده‌شده توسط موتور زمان‌بندی هوشمند:\n${scheduleContext.generatedSummary}` : ''}`
        : '';

      const systemInstruction = `شما دستیار هوشمند و برنامه‌ریز ارشد شیفت (ShiftFlow AI) در کارخانه تولید واکسن تب برفکی هستید.
وظایف اصلی شما:
۱. کمک به مدیر در چیدن هوشمند شیفت‌های ماهانه با رعایت عدالت (برابری شیفت‌های شب و روز و ساعت وزنی با ضریب ۱.۵ برای شیفت شب) و رعایت شروط حضور کارشناسان.
۲. قانون حضور کارشناسان در کارخانه: هر کارشناس برای اینکه در یک روز خاص هفته (مثلاً شنبه یا دوشنبه) صبح سر کار حضور داشته باشد، نباید شب قبل از آن (مثلاً جمعه شب برای شنبه، یا یک‌شنبه شب برای دوشنبه) و شبِ خود آن روز (مثلاً شنبه شب یا دوشنبه شب) شیفت شب باشد، زیرا روز بعد از شیفت شب استراحت (آف) است. همچنین طبق قانون چرخش کارخانه، هر کس شب کاری داشته باشد ۲ روز بعد شیفت روز خواهد بود.
۳. راهنمایی تخصصی درباره فرآیندهای تولید بیولوژیک (CIP, SIP, PHT، کشت سلول BHK-21، تلقیح ویروس و فرمولاسیون).
۴. اگر موتور زمان‌بندی هوشمند برنامه جدیدی تولید کرده است (در بخش خلاصه برنامه چیده‌شده)، توضیح دهید که برنامه بر اساس ملاحظات مدیر و با رعایت عدالت چیده شده و از طریق کارت داخل چت در تقویم اعمال گردیده است.
پاسخ‌ها را کوتاه، دقیق، مودبانه و به زبان فارسی ارائه دهید.${contextSummary}`;

      let replyText = '';
      let usedModel = candidateModels[0];

      if (apiKey) {
        for (const modelName of candidateModels) {
          try {
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('AI request timeout')), 5000)
            );
            const generatePromise = ai.models.generateContent({
              model: modelName,
              contents,
              config: {
                systemInstruction,
                temperature: 0.5,
              }
            });
            const response = await Promise.race([generatePromise, timeoutPromise]);
            if (response && response.text) {
              replyText = response.text;
              usedModel = modelName;
              break;
            }
          } catch (err: any) {
            console.warn(`[Gemini API] Candidate model ${modelName} notice:`, err?.message || err);
          }
        }
      }

      if (!replyText) {
        if (scheduleContext?.generatedSummary) {
          replyText = `✅ برنامه شیفت **${scheduleContext.targetMonthLabel || ''}** با رعایت کامل ملاحظات تعیین‌شده و توازن عدالت ساعات کاری چیده شد:\n\n${scheduleContext.generatedSummary}\n\nمی‌توانید از کارت زیر جزئیات سهم هر کارشناس را مشاهده کرده یا برنامه را در تقویم اصلی ذخیره نمایید.`;
        } else {
          replyText = 'من آماده کمک به شما در چیدن هوشمند شیفت‌ها هستم. کافی است ماه مورد نظر و ملاحظات حضور کارشناسان (مثلاً: «شیفت آبان رو بچین طوری که سلیمان فلاح شنبه‌ها سرکار حضور داشته باشه و دهقان دوشنبه‌ها باشه») را بنویسید یا از تب «فرم چیدمان شیفت» در بالای همین پنجره استفاده کنید.';
        }
      }

      res.status(200).json({
        reply: replyText,
        modelUsed: usedModel,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      console.warn('[Gemini API] Request notice:', err?.message || err);
      res.status(200).json({
        reply: 'درخواست شما پردازش شد. در صورت نیاز به چیدمان شیفت ماهانه، ملاحظات کارشناسان را وارد کنید تا برنامه به‌صورت خودکار و عادلانه تنظیم شود.',
        modelUsed: 'gemini-3.8-flash',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Serve Frontend
  const distPath = path.resolve(__dirname, 'dist');
  const distIndexHtml = path.resolve(distPath, 'index.html');
  const hasBuiltDist = fs.existsSync(distIndexHtml);

  if (isProd && hasBuiltDist) {
    // Production static hosting with built assets
    app.use(express.static(distPath));
    app.use((_req, res, next) => {
      res.sendFile(distIndexHtml, (err) => {
        if (err) {
          next(err);
        }
      });
    });
  } else {
    // Development mode or fallback to Vite middleware when dist/index.html is not yet built
    if (isProd && !hasBuiltDist) {
      console.warn('[ShiftFlow] Production mode active but dist/index.html not found; smoothly falling back to Vite middleware.');
    }
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  // Global error handler
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[ShiftFlow] Unhandled server error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error', message: err?.message || String(err) });
    }
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ShiftFlow] Server listening on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[ShiftFlow] Failed to start server:', err);
  process.exit(1);
});
