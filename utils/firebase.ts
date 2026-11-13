/**
 * Firebase Firestore & Direct Server Real-Time Sync Module - v2.0.0
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  onSnapshot,
  setDoc,
  getDocFromServer,
  Unsubscribe,
  Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { ShiftEntry, Personnel, PublishedRange, DailyProcessMap, ProcessDefinition } from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface CloudRosterState {
  schedule: ShiftEntry[];
  personnelList: Personnel[];
  unlockedMonths: string[];
  publishedRange: PublishedRange | null;
  adminPassword?: string;
  dailyProcesses?: DailyProcessMap;
  processDefinitions?: ProcessDefinition[];
  showProcessSchedule?: boolean;
  updatedAt: string;
  _version?: number;
  _originClientId?: string;
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore with explicit database ID from config
export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);

let isDirectFirestoreUsable = true;
let isFirestoreQuotaExhausted = false;

export function isQuotaLimitReached(): boolean {
  return isFirestoreQuotaExhausted;
}

/**
 * Validate initial connection to Firestore backend with timeout
 * Never blocks the applet on filtered networks.
 */
export async function testConnection(): Promise<boolean> {
  if (isFirestoreQuotaExhausted) {
    return false;
  }
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Firestore connection timeout')), 5000)
    );
    await Promise.race([getDocFromServer(doc(db, 'test', 'connection')), timeoutPromise]);
    isDirectFirestoreUsable = true;
    return true;
  } catch (error: any) {
    const errMsg = String(error?.message || error);
    if (
      errMsg.includes('RESOURCE_EXHAUSTED') ||
      errMsg.includes('resource-exhausted') ||
      error?.code === 'resource-exhausted' ||
      error?.code === 8
    ) {
      isFirestoreQuotaExhausted = true;
      updateSyncDetails({ isQuotaExhausted: true, firestoreConnected: false });
    }
    return false;
  }
}

const ROSTER_DOC_PATH = 'roster_state';
const ROSTER_DOC_ID = 'current';

/**
 * Sync status provider for UI indicators
 */
export interface SyncStatusDetails {
  serverConnected: boolean;
  firestoreConnected: boolean;
  lastSyncTime: string | null;
  channel: 'server' | 'firestore' | 'both' | 'offline';
  isQuotaExhausted?: boolean;
}

let currentSyncDetails: SyncStatusDetails = {
  serverConnected: true,
  firestoreConnected: false,
  lastSyncTime: null,
  channel: 'server',
  isQuotaExhausted: false,
};

export const CLIENT_ID = 'client_' + Math.random().toString(36).substring(2, 9);

/**
 * Deterministic fingerprint of a schedule array so every tab/device accurately knows
 * if an incoming schedule is different from its own in-memory schedule — completely
 * immune to device clock skew or shared localStorage timestamps.
 */
export function getScheduleFingerprint(schedule?: ShiftEntry[]): string {
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return '';
  return schedule
    .map(
      (s) =>
        `${s.date}:${s.dayShiftPerson || ''}:${s.nightShiftPerson || ''}:${s.onCallPerson || ''}:${(
          s.extraDayPersons || []
        ).join(',')}:${(s.extraNightPersons || []).join(',')}:${s.isHoliday ? '1' : '0'}`
    )
    .join('|');
}

// Per-instance in-memory fingerprint of the currently applied schedule
let currentInstanceScheduleFingerprint = '';
let lastLocalMutationTimeMs = 0;

export function setLocalScheduleFingerprint(schedule: ShiftEntry[]) {
  const fp = getScheduleFingerprint(schedule);
  if (fp) {
    currentInstanceScheduleFingerprint = fp;
  }
}

let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel('shiftflow_sync_channel');
  } catch (e) {
    console.warn('BroadcastChannel not supported:', e);
  }
}

export function broadcastLocalStateChange(data: Partial<CloudRosterState>) {
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'SYNC_UPDATE', data, clientId: CLIENT_ID });
    } catch (e) {
      console.warn('BroadcastChannel error:', e);
    }
  }
}

const syncListeners = new Set<(details: SyncStatusDetails) => void>();

export function subscribeSyncStatus(listener: (details: SyncStatusDetails) => void): () => void {
  syncListeners.add(listener);
  listener(currentSyncDetails);
  return () => syncListeners.delete(listener);
}

function updateSyncDetails(partial: Partial<SyncStatusDetails>) {
  currentSyncDetails = { ...currentSyncDetails, ...partial };
  syncListeners.forEach((l) => {
    try {
      l(currentSyncDetails);
    } catch {
      // listener error
    }
  });
}

export const isStandaloneAndroidRuntime = (): boolean => {
  if (typeof window === 'undefined') return false;
  const proto = window.location.protocol;
  const host = window.location.hostname;
  const port = window.location.port;
  return (
    proto === 'capacitor:' ||
    proto === 'file:' ||
    Boolean((window as any).AndroidBridge) ||
    Boolean((window as any).Capacitor?.isNativePlatform?.()) ||
    (host === 'localhost' && !port)
  );
};

export const CUSTOM_SYNC_URL_STORAGE_KEY = 'shiftflow_custom_sync_url';
export const DEFAULT_VERCEL_SYNC_URL = 'https://shiftflow-sync.rzcegpj.workers.dev';

export const REMOTE_SERVER_URLS: string[] = ['https://shiftflow-sync.rzcegpj.workers.dev'];

// Remember endpoints that returned permanent failures (e.g. 402 DEPLOYMENT_DISABLED or 404 on static hosts)
const deadEndpointUrls = new Set<string>();

function getFirestoreRestDocUrl(): string {
  const projectId = firebaseConfig.projectId || 'beaming-source-hcbh2';
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
  const apiKey = firebaseConfig.apiKey ? `?key=${encodeURIComponent(firebaseConfig.apiKey)}` : '';
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${ROSTER_DOC_PATH}/${ROSTER_DOC_ID}${apiKey}`;
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

async function fetchFirestoreDocREST(timeoutMs = 7000): Promise<CloudRosterState | null> {
  if (isFirestoreQuotaExhausted) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = getFirestoreRestDocUrl();
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.status === 429) {
      isFirestoreQuotaExhausted = true;
      updateSyncDetails({ isQuotaExhausted: true, firestoreConnected: false });
      return null;
    }
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`Firestore REST GET failed with ${res.status}`);
    }
    const docJson = await res.json();
    if (!docJson || !docJson.fields) return null;
    const decoded: any = {};
    for (const [k, v] of Object.entries(docJson.fields)) {
      decoded[k] = decodeFirestoreRestValue(v);
    }
    isDirectFirestoreUsable = true;
    updateSyncDetails({ firestoreConnected: true });
    return decoded as CloudRosterState;
  } finally {
    clearTimeout(timer);
  }
}

async function writeFirestoreDocREST(data: Record<string, any>, merge = true): Promise<boolean> {
  if (isFirestoreQuotaExhausted) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreRestValue(v);
      }
    }
    let url = getFirestoreRestDocUrl();
    if (merge) {
      const sep = url.includes('?') ? '&' : '?';
      const mask = Object.keys(fields)
        .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
        .join('&');
      if (mask) url += `${sep}${mask}`;
    }
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
      signal: controller.signal,
    });
    if (res.status === 429) {
      isFirestoreQuotaExhausted = true;
      updateSyncDetails({ isQuotaExhausted: true, firestoreConnected: false });
      return false;
    }
    if (!res.ok) {
      throw new Error(`Firestore REST PATCH failed with ${res.status}`);
    }
    isDirectFirestoreUsable = true;
    updateSyncDetails({
      firestoreConnected: true,
      lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
    });
    return true;
  } finally {
    clearTimeout(timer);
  }
}

function isStaticHostingOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname.toLowerCase();
  return h.endsWith('github.io') || h.endsWith('pages.dev') || h.endsWith('netlify.app');
}

export function getCustomServerUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_VERCEL_SYNC_URL;
  try {
    const custom = localStorage.getItem(CUSTOM_SYNC_URL_STORAGE_KEY);
    if (custom !== null) {
      const cleaned = custom.trim().replace(/\/+$/, '');
      // Auto-migrate away from dead Vercel URL to the active Cloudflare Worker relay
      if (cleaned === 'https://android-fmd-shift-flow.vercel.app') {
        return DEFAULT_VERCEL_SYNC_URL;
      }
      return cleaned;
    }
    // Check Vite environment variable if configured during build
    const envUrl = (import.meta as any).env?.VITE_VERCEL_SYNC_URL;
    if (envUrl && typeof envUrl === 'string' && envUrl.trim()) {
      return envUrl.trim().replace(/\/+$/, '');
    }
  } catch {}
  return DEFAULT_VERCEL_SYNC_URL;
}

export function setCustomServerUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    const cleaned = url ? url.trim().replace(/\/+$/, '') : '';
    deadEndpointUrls.clear();
    localStorage.setItem(CUSTOM_SYNC_URL_STORAGE_KEY, cleaned);
  } catch {}
}

export function getActiveServerUrls(): string[] {
  const urls: string[] = [];
  const custom = getCustomServerUrl();
  if (custom && !deadEndpointUrls.has(custom)) {
    urls.push(custom);
  }
  for (const url of REMOTE_SERVER_URLS) {
    if (url && !urls.includes(url) && !deadEndpointUrls.has(url)) {
      urls.push(url);
    }
  }
  return urls;
}

export async function testServerUrlConnection(rawUrl: string): Promise<{ success: boolean; message: string; latency?: number }> {
  const cleanUrl = rawUrl.trim().replace(/\/+$/, '');
  if (!cleanUrl) {
    return { success: false, message: 'آدرس سرور وارد نشده است.' };
  }
  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${cleanUrl}/api/sync?action=health&_t=${Date.now()}`, {
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeout);
    const latency = Date.now() - startTime;
    if (res.ok) {
      deadEndpointUrls.delete(cleanUrl);
      return {
        success: true,
        message: `اتصال به سرور واسط موفقیت‌آمیز بود (${latency}ms) - آماده و بدون فیلتر`,
        latency
      };
    }
    if (res.status === 402) {
      return {
        success: false,
        message: 'این سرور ورسل غیرفعال شده است (خطای 402 Payment Required). می‌توانید از اتصال مستقیم فایربیس استفاده کنید یا آدرس یک سرور جدید (مثلاً Cloudflare Worker رایگان) وارد نمایید.'
      };
    }
    return {
      success: false,
      message: `پاسخ از سرور دریافت شد ولی کد وضعیت ${res.status} بود.`
    };
  } catch (err: any) {
    return {
      success: false,
      message: `خطای برقراری ارتباط با سرور: ${err?.message || 'تایم‌اوت یا عدم دسترسی'}`
    };
  }
}

export function getSyncApiBase(): string {
  const custom = getCustomServerUrl();
  if (custom && !deadEndpointUrls.has(custom)) return custom;
  if (isStandaloneAndroidRuntime() && getActiveServerUrls().length > 0) {
    return getActiveServerUrls()[0];
  }
  return '';
}

/**
 * Subscribes to real-time changes of the roster using Dual Sync:
 * 1. Direct Server SSE (/api/sync/stream) + Polling when an active relay server exists
 * 2. Same-Browser Multi-Tab BroadcastChannel + window storage event
 * 3. Firestore Real-Time onSnapshot + Firestore REST API fallback (works cleanly on GitHub Pages)
 */
export function subscribeToCloudRoster(
  onUpdate: (data: CloudRosterState) => void,
  onInitialEmpty?: () => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  let isCancelled = false;
  let hasReceivedAnyData = false;
  let lastAppliedVersion = 0;
  let lastAppliedMetaHash = '';
  const isNativeAndroid = isStandaloneAndroidRuntime();
  const isStaticHost = isStaticHostingOrigin();

  // Initialize syncDetails cleanly (don't falsely claim serverConnected on static GitHub Pages)
  updateSyncDetails({
    serverConnected: false,
    firestoreConnected: false,
    channel: 'offline',
  });

  const getMetaHash = (d: CloudRosterState): string => {
    return JSON.stringify({
      u: d.unlockedMonths || [],
      p: d.publishedRange || null,
      s: d.showProcessSchedule,
      pl: (d.personnelList || []).map((x) => `${x.name}:${x.color}:${x.isActive}`),
    });
  };

  const handleIncomingData = (
    data: CloudRosterState,
    source: 'server' | 'firestore' | 'broadcast',
    originClientId?: string
  ) => {
    if (isCancelled || !data) return;

    const effectiveOrigin = originClientId || data._originClientId;
    if (effectiveOrigin && effectiveOrigin === CLIENT_ID) {
      return;
    }

    const incomingFp = getScheduleFingerprint(data.schedule);
    const incomingMeta = getMetaHash(data);
    const incomingVersion = typeof data._version === 'number' ? data._version : 0;

    if (Date.now() - lastLocalMutationTimeMs < 1500 && hasReceivedAnyData) {
      if (incomingFp === currentInstanceScheduleFingerprint) {
        return;
      }
    }

    const nextServerConnected =
      source === 'server' || source === 'broadcast' ? true : currentSyncDetails.serverConnected;
    const nextFirestoreConnected =
      source === 'firestore' ? true : currentSyncDetails.firestoreConnected;

    updateSyncDetails({
      serverConnected: nextServerConnected,
      firestoreConnected: nextFirestoreConnected,
      lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
      channel:
        nextServerConnected && nextFirestoreConnected
          ? 'both'
          : nextFirestoreConnected
          ? 'firestore'
          : 'server',
    });

    const isScheduleChanged =
      Boolean(incomingFp) && incomingFp !== currentInstanceScheduleFingerprint;
    const isMetaChanged = incomingMeta !== lastAppliedMetaHash;
    const isNewerVersion = incomingVersion > 0 && incomingVersion > lastAppliedVersion;

    if (hasReceivedAnyData && !isScheduleChanged && !isMetaChanged && !isNewerVersion) {
      return;
    }

    if (incomingFp) {
      currentInstanceScheduleFingerprint = incomingFp;
    }
    lastAppliedMetaHash = incomingMeta;
    if (incomingVersion > lastAppliedVersion) {
      lastAppliedVersion = incomingVersion;
    }
    if (typeof localStorage !== 'undefined' && data.updatedAt) {
      try {
        localStorage.setItem('shiftflow_updated_at', data.updatedAt);
      } catch {}
    }
    hasReceivedAnyData = true;

    onUpdate(data);
  };

  // 0. Same-browser multi-tab instant sync via BroadcastChannel & storage event
  const handleBroadcast = (event: MessageEvent) => {
    if (isCancelled) return;
    if (event.data && event.data.type === 'SYNC_UPDATE' && event.data.data) {
      handleIncomingData(event.data.data as CloudRosterState, 'broadcast', event.data.clientId);
    }
  };
  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', handleBroadcast);
  }

  const handleStorageEvent = (event: StorageEvent) => {
    if (isCancelled) return;
    if (event.key === 'shiftflow_schedule_v2' && event.newValue) {
      try {
        const parsedSchedule = JSON.parse(event.newValue) as ShiftEntry[];
        if (Array.isArray(parsedSchedule) && parsedSchedule.length > 0) {
          const incomingFp = getScheduleFingerprint(parsedSchedule);
          if (incomingFp && incomingFp !== currentInstanceScheduleFingerprint) {
            handleIncomingData(
              {
                schedule: parsedSchedule,
                personnelList: [],
                unlockedMonths: [],
                publishedRange: undefined as any,
                updatedAt: new Date().toISOString(),
              },
              'broadcast'
            );
          }
        }
      } catch {}
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageEvent);
  }

  // Helper to fetch from custom/local server `/api/sync` without retrying dead 402/404 endpoints
  const tryServerSyncGet = async (base: string): Promise<any | null> => {
    const key = base || '__local__';
    if (deadEndpointUrls.has(key)) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const url = base ? `${base}/api/sync?_t=${Date.now()}` : `/api/sync?_t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timer);

      if (res.status === 402 || res.status === 404 || res.status === 410) {
        deadEndpointUrls.add(key);
        return null;
      }
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        return await res.json();
      }
      if (res.ok && !ct.includes('application/json')) {
        deadEndpointUrls.add(key);
      }
    } catch {}
    return null;
  };

  // 1. Direct Server API + Firestore SDK + Firestore REST fallback fetch
  const fetchFromEndpoints = async (): Promise<{ result: any; source: 'server' | 'firestore' }> => {
    if (!isNativeAndroid) {
      if (!isStaticHost) {
        const localJson = await tryServerSyncGet('');
        if (localJson) return { result: localJson, source: 'server' };
      }
      const customUrl = getCustomServerUrl();
      if (customUrl) {
        const customJson = await tryServerSyncGet(customUrl);
        if (customJson) return { result: customJson, source: 'server' };
      }
    } else {
      for (const base of getActiveServerUrls()) {
        const remoteJson = await tryServerSyncGet(base);
        if (remoteJson) return { result: remoteJson, source: 'server' };
      }
    }

    // Firestore REST API (lightweight HTTPS fetch — works even when gRPC WebChannel lags)
    if (!isFirestoreQuotaExhausted) {
      try {
        const restData = await fetchFirestoreDocREST(6000);
        if (restData) {
          return {
            result: {
              exists: true,
              modified: true,
              updatedAt: restData.updatedAt,
              data: restData,
            },
            source: 'firestore',
          };
        }
      } catch {}

      // Firestore SDK getDocFromServer fallback
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Firestore fetch timeout')), 6000)
        );
        const snap = await Promise.race([
          getDocFromServer(doc(db, ROSTER_DOC_PATH, ROSTER_DOC_ID)),
          timeoutPromise,
        ]);
        isDirectFirestoreUsable = true;
        updateSyncDetails({ firestoreConnected: true });
        if (snap.exists()) {
          const cloudData = snap.data() as CloudRosterState;
          return {
            result: {
              exists: true,
              modified: true,
              updatedAt: cloudData.updatedAt,
              data: cloudData,
            },
            source: 'firestore',
          };
        }
        return {
          result: { exists: false, data: null },
          source: 'firestore',
        };
      } catch (err: any) {
        const msg = String(err?.message || err);
        if (msg.includes('Missing or insufficient permissions') || err?.code === 'permission-denied') {
          handleFirestoreError(err, OperationType.GET, `${ROSTER_DOC_PATH}/${ROSTER_DOC_ID}`);
        }
        if (
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('resource-exhausted') ||
          err?.code === 'resource-exhausted' ||
          err?.code === 8
        ) {
          isFirestoreQuotaExhausted = true;
          updateSyncDetails({ isQuotaExhausted: true, firestoreConnected: false });
        }
      }
    }

    throw new Error('All remote endpoints unreachable');
  };

  const doFetchInitial = (attempt = 1) => {
    if (isCancelled) return;
    fetchFromEndpoints()
      .then(({ result: resData, source }) => {
        if (isCancelled) return;
        if (resData && resData.exists && resData.data) {
          handleIncomingData(resData.data, source);
        } else if (resData && !resData.exists) {
          if (!hasReceivedAnyData && onInitialEmpty) {
            onInitialEmpty();
          }
        }
      })
      .catch((err) => {
        if (isCancelled) return;
        // If onSnapshot already connected in the meantime, do NOT mark offline
        if (currentSyncDetails.firestoreConnected || currentSyncDetails.serverConnected) {
          return;
        }
        if (!hasReceivedAnyData) {
          if (attempt < 2) {
            setTimeout(() => doFetchInitial(attempt + 1), 1500);
          } else if (onError) {
            onError(err);
          }
        }
      });
  };

  doFetchInitial(1);

  // 2. Direct Server-Sent Events (SSE) Stream — ONLY connect when an active backend server exists
  let eventSource: EventSource | null = null;
  let sseReconnectTimer: any = null;
  const syncApiBase = getSyncApiBase();
  const hasServerEndpoint =
    (Boolean(syncApiBase) && !deadEndpointUrls.has(syncApiBase)) ||
    (!isNativeAndroid && !isStaticHost && !deadEndpointUrls.has('__local__'));

  const connectSSE = () => {
    if (isCancelled || typeof window === 'undefined' || !('EventSource' in window)) return;
    const currentBase = getSyncApiBase();
    const activeKey = currentBase || '__local__';
    if (
      (!currentBase && (isNativeAndroid || isStaticHost)) ||
      deadEndpointUrls.has(activeKey) ||
      currentBase.includes('.workers.dev')
    ) {
      return;
    }
    try {
      if (eventSource) {
        try {
          eventSource.close();
        } catch {}
      }
      const streamUrl = `${currentBase}/api/sync/stream`;
      eventSource = new EventSource(streamUrl);
      eventSource.onopen = () => {
        updateSyncDetails({
          serverConnected: true,
          channel: currentSyncDetails.firestoreConnected ? 'both' : 'server',
        });
      };
      eventSource.onmessage = (event) => {
        if (isCancelled) return;
        try {
          const parsed = JSON.parse(event.data);
          if (parsed && parsed.data) {
            handleIncomingData(parsed.data, 'server', parsed.data._originClientId);
          }
        } catch (e) {
          console.warn('[DirectServerSync] SSE parse error:', e);
        }
      };
      eventSource.onerror = () => {
        try {
          eventSource?.close();
        } catch {}
        if (!isCancelled && !deadEndpointUrls.has(activeKey)) {
          if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
          sseReconnectTimer = setTimeout(connectSSE, 6000);
        }
      };
    } catch {}
  };

  if (hasServerEndpoint) {
    connectSSE();
  }

  // 3. Smart Background Polling:
  // - If an active custom/local `/api/sync` server exists: poll server every 4s.
  // - If ONLY Firestore exists (e.g. GitHub Pages): rely on onSnapshot and only poll REST every 20s if Firestore isn't connected yet (saves quota!).
  const fetchLatestFromServer = () => {
    if (isCancelled) return;
    const activeServers = getActiveServerUrls();
    const canUseLocalServer = !isNativeAndroid && !isStaticHost && !deadEndpointUrls.has('__local__');
    if (currentSyncDetails.firestoreConnected && activeServers.length === 0 && !canUseLocalServer) {
      return;
    }
    fetchFromEndpoints()
      .then(({ result: resData, source }) => {
        if (isCancelled || !resData) return;
        updateSyncDetails({
          serverConnected: source === 'server' ? true : currentSyncDetails.serverConnected,
          firestoreConnected: source === 'firestore' ? true : currentSyncDetails.firestoreConnected,
          lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
        });
        if (resData.exists && resData.data) {
          handleIncomingData(resData.data, source, resData.data._originClientId);
        }
      })
      .catch(() => {});
  };

  const pollIntervalMs = hasServerEndpoint ? 4000 : 20000;
  const pollTimer = setInterval(fetchLatestFromServer, pollIntervalMs);

  // Dedicated Web Worker timer so browsers do NOT throttle background sync when minimized
  let bgWorker: Worker | null = null;
  if (typeof window !== 'undefined' && 'Worker' in window && 'Blob' in window) {
    try {
      const workerInterval = hasServerEndpoint ? 4000 : 20000;
      const workerCode = `setInterval(function(){ postMessage('BG_SYNC_TICK'); }, ${workerInterval});`;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      bgWorker = new Worker(workerUrl);
      bgWorker.onmessage = () => {
        if (!isCancelled) {
          fetchLatestFromServer();
          if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            try {
              navigator.serviceWorker.controller.postMessage({ type: 'BG_HEARTBEAT_PING' });
            } catch {}
          }
        }
      };
    } catch {}
  }

  // Immediate sync when tab becomes active / device unlocked
  const handleVisibilityOrFocus = () => {
    fetchLatestFromServer();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
  }

  // 4. Firestore direct listener attached IMMEDIATELY (no testConnection gatekeeper!)
  let firestoreUnsubscribe: Unsubscribe | null = null;
  if (!isFirestoreQuotaExhausted) {
    try {
      const docRef = doc(db, ROSTER_DOC_PATH, ROSTER_DOC_ID);
      firestoreUnsubscribe = onSnapshot(
        docRef,
        { includeMetadataChanges: false },
        (snapshot) => {
          if (isCancelled) return;
          isDirectFirestoreUsable = true;
          updateSyncDetails({
            firestoreConnected: true,
            lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
            channel: currentSyncDetails.serverConnected ? 'both' : 'firestore',
          });
          if (snapshot.exists()) {
            const data = snapshot.data() as CloudRosterState;
            handleIncomingData(data, 'firestore', data._originClientId);
          } else if (!hasReceivedAnyData && onInitialEmpty) {
            onInitialEmpty();
          }
        },
        (err) => {
          const msg = String(err?.message || err);
          if (
            msg.includes('Missing or insufficient permissions') ||
            (err as any)?.code === 'permission-denied'
          ) {
            handleFirestoreError(err, OperationType.GET, `${ROSTER_DOC_PATH}/${ROSTER_DOC_ID}`);
          }
          if (
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('resource-exhausted') ||
            (err as any)?.code === 'resource-exhausted' ||
            (err as any)?.code === 8
          ) {
            isFirestoreQuotaExhausted = true;
            isDirectFirestoreUsable = false;
            updateSyncDetails({ isQuotaExhausted: true, firestoreConnected: false });
          } else {
            updateSyncDetails({ firestoreConnected: false });
          }
        }
      );
    } catch {
      updateSyncDetails({ firestoreConnected: false });
    }
  }

  return () => {
    isCancelled = true;
    if (pollTimer) clearInterval(pollTimer);
    if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
    if (bgWorker) {
      try {
        bgWorker.terminate();
      } catch {}
    }
    if (broadcastChannel) {
      broadcastChannel.removeEventListener('message', handleBroadcast);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    }
    if (eventSource) {
      try {
        eventSource.close();
      } catch {}
    }
    if (firestoreUnsubscribe) {
      firestoreUnsubscribe();
    }
  };
}

/**
 * Fetches latest roster state on-demand from Server API, Firestore REST, or Firestore SDK
 */
export async function fetchLatestCloudRosterNow(): Promise<CloudRosterState | null> {
  const isAndroid = isStandaloneAndroidRuntime();
  const isStaticHost = isStaticHostingOrigin();
  const customUrl = getCustomServerUrl();

  if (!isAndroid) {
    if (!isStaticHost && !deadEndpointUrls.has('__local__')) {
      try {
        const res = await fetch(`/api/sync?_t=${Date.now()}`, { cache: 'no-store' });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const json = await res.json();
          if (json?.exists && json?.data) {
            updateSyncDetails({ serverConnected: true, lastSyncTime: new Date().toLocaleTimeString('fa-IR') });
            return json.data as CloudRosterState;
          }
        } else if (res.status === 404 || res.status === 402) {
          deadEndpointUrls.add('__local__');
        }
      } catch {}
    }

    if (customUrl && !deadEndpointUrls.has(customUrl)) {
      try {
        const res = await fetch(`${customUrl}/api/sync?_t=${Date.now()}`, { cache: 'no-store' });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const json = await res.json();
          if (json?.exists && json?.data) {
            updateSyncDetails({ serverConnected: true, lastSyncTime: new Date().toLocaleTimeString('fa-IR') });
            return json.data as CloudRosterState;
          }
        } else if (res.status === 402 || res.status === 404 || res.status === 410) {
          deadEndpointUrls.add(customUrl);
        }
      } catch {}
    }
  } else {
    for (const base of getActiveServerUrls()) {
      try {
        const res = await fetch(`${base}/api/sync?_t=${Date.now()}`, { cache: 'no-store' });
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const json = await res.json();
          if (json?.exists && json?.data) {
            updateSyncDetails({ serverConnected: true, lastSyncTime: new Date().toLocaleTimeString('fa-IR') });
            return json.data as CloudRosterState;
          }
        } else if (res.status === 402 || res.status === 404 || res.status === 410) {
          deadEndpointUrls.add(base);
        }
      } catch {}
    }
  }

  if (!isFirestoreQuotaExhausted) {
    try {
      const restData = await fetchFirestoreDocREST(7000);
      if (restData) {
        updateSyncDetails({
          firestoreConnected: true,
          lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
          channel: currentSyncDetails.serverConnected ? 'both' : 'firestore',
        });
        return restData;
      }
    } catch {}

    try {
      const snap = await getDocFromServer(doc(db, ROSTER_DOC_PATH, ROSTER_DOC_ID));
      if (snap.exists()) {
        updateSyncDetails({
          firestoreConnected: true,
          lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
          channel: currentSyncDetails.serverConnected ? 'both' : 'firestore',
        });
        return snap.data() as CloudRosterState;
      }
    } catch {}
  }
  return null;
}

/**
 * Sanitizes an object before writing to Firestore by removing any keys with `undefined` values.
 */
function cleanFirestoreData<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) => {
      if (value === undefined) {
        return undefined;
      }
      return value;
    })
  );
}

/**
 * Saves or updates roster data with Dual Sync across BOTH Web Browser and Native Android App:
 * 1. Updates in-memory schedule fingerprint & broadcasts to same-browser tabs immediately.
 * 2. Writes directly to Firestore SDK + Firestore REST API fallback.
 * 3. POSTs to Direct Server API (/api/sync) if an active server is configured.
 */
export async function saveCloudRoster(data: Partial<CloudRosterState>): Promise<void> {
  const now = new Date().toISOString();
  lastLocalMutationTimeMs = Date.now();

  if (data.schedule && Array.isArray(data.schedule)) {
    setLocalScheduleFingerprint(data.schedule);
  }

  const payload = cleanFirestoreData({
    ...data,
    updatedAt: now,
    _originClientId: CLIENT_ID,
  });

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('shiftflow_updated_at', now);
    } catch {}
  }

  // 1. Broadcast to other tabs in the same browser immediately (0ms latency)
  broadcastLocalStateChange(payload);

  // 2. Direct Firestore write (SDK + REST fallback)
  const writePromises: Promise<any>[] = [];
  if (!isFirestoreQuotaExhausted) {
    writePromises.push(
      setDoc(doc(db, ROSTER_DOC_PATH, ROSTER_DOC_ID), payload, { merge: true })
        .then(() => {
          isDirectFirestoreUsable = true;
          updateSyncDetails({
            firestoreConnected: true,
            lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
            channel: currentSyncDetails.serverConnected ? 'both' : 'firestore',
          });
        })
        .catch(async (err) => {
          const msg = String(err?.message || err);
          if (msg.includes('Missing or insufficient permissions') || err?.code === 'permission-denied') {
            handleFirestoreError(err, OperationType.WRITE, `${ROSTER_DOC_PATH}/${ROSTER_DOC_ID}`);
          }
          // Try lightweight REST write if SDK fails
          const ok = await writeFirestoreDocREST(payload, true);
          if (!ok) throw err;
        })
    );
  }

  // 3. Direct Server Sync POST (only to active non-dead server endpoints)
  const isAndroid = isStandaloneAndroidRuntime();
  const isStaticHost = isStaticHostingOrigin();
  const customUrl = getCustomServerUrl();
  const targetUrls: string[] = [];
  if (isAndroid) {
    targetUrls.push(...getActiveServerUrls().map((base) => `${base}/api/sync`));
  } else {
    if (!isStaticHost && !deadEndpointUrls.has('__local__')) {
      targetUrls.push('/api/sync');
    }
    if (customUrl && !deadEndpointUrls.has(customUrl)) {
      targetUrls.push(`${customUrl}/api/sync`);
    }
  }

  for (const url of targetUrls) {
    writePromises.push(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload, clientId: CLIENT_ID }),
      }).then(async (r) => {
        if (r.status === 402 || r.status === 404 || r.status === 410) {
          const base = url.replace(/\/api\/sync$/, '') || '__local__';
          deadEndpointUrls.add(base);
          throw new Error(`Server unavailable (${r.status})`);
        }
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        const json = await r.json();
        updateSyncDetails({
          serverConnected: true,
          lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
          channel: currentSyncDetails.firestoreConnected ? 'both' : 'server',
        });
        return json;
      })
    );
  }

  if (writePromises.length > 0) {
    await Promise.race([
      Promise.any(writePromises),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Cloud sync save timeout')), 6000)
      ),
    ]);
  }
}

/**
 * Overwrites entire cloud roster with fresh initial data across both channels.
 */
export async function resetCloudRoster(data: CloudRosterState): Promise<void> {
  const now = new Date().toISOString();
  lastLocalMutationTimeMs = Date.now();
  if (data.schedule) {
    setLocalScheduleFingerprint(data.schedule);
  }

  const payload = cleanFirestoreData({
    ...data,
    updatedAt: now,
    _originClientId: CLIENT_ID,
  });

  broadcastLocalStateChange(payload);

  if (isDirectFirestoreUsable && !isFirestoreQuotaExhausted) {
    try {
      await setDoc(doc(db, ROSTER_DOC_PATH, ROSTER_DOC_ID), payload);
    } catch {
      await writeFirestoreDocREST(payload, false).catch(() => {});
    }
  }

  const isAndroid = isStandaloneAndroidRuntime();
  const isStaticHost = isStaticHostingOrigin();
  const customUrl = getCustomServerUrl();
  const targetUrls: string[] = [];
  if (isAndroid) {
    targetUrls.push(...getActiveServerUrls().map((base) => `${base}/api/sync/reset`));
  } else {
    if (!isStaticHost && !deadEndpointUrls.has('__local__')) {
      targetUrls.push('/api/sync/reset');
    }
    if (customUrl && !deadEndpointUrls.has(customUrl)) {
      targetUrls.push(`${customUrl}/api/sync/reset`);
    }
  }

  await Promise.allSettled(
    targetUrls.map((url) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload }),
      })
    )
  );
}
