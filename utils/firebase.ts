/**
 * Firebase Firestore & Direct Server Real-Time Sync Module - v2.0.0
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  setLogLevel,
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
  _revision?: number;
  _baseUpdatedAt?: string;
  _clientBuild?: string;
  _originClientId?: string;
  _userEdited?: boolean;
  _scheduleEdited?: boolean;
  _explicitReset?: boolean;
}

const CLIENT_BUILD_ID = 'shiftflow-v2.2';
export const LEGACY_STALE_SCHEDULE_HASH = '88aedc2d';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore with explicit database ID from config and silence noisy internal stream idle logs
export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);
try {
  setLogLevel('silent');
} catch {}

let isDirectFirestoreUsable = true;
let isDirectFirestoreBlockedUntilMs = 0;
let isFirestoreQuotaExhausted = false;

function isDirectFirestoreTemporarilyBlocked(): boolean {
  return Date.now() < isDirectFirestoreBlockedUntilMs;
}

function markDirectFirestoreBlocked() {
  isDirectFirestoreUsable = false;
  isDirectFirestoreBlockedUntilMs = Date.now() + 90000; // Re-probe direct Firestore after 90s
}

function markDirectFirestoreHealthy() {
  isDirectFirestoreUsable = true;
  isDirectFirestoreBlockedUntilMs = 0;
}

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
  hasUnsavedChanges?: boolean;
}

let currentSyncDetails: SyncStatusDetails = {
  serverConnected: true,
  firestoreConnected: false,
  lastSyncTime: null,
  channel: 'server',
  isQuotaExhausted: false,
  hasUnsavedChanges: false,
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

export function getScheduleHash(schedule?: ShiftEntry[]): string {
  if (!schedule || !Array.isArray(schedule) || schedule.length === 0) return 'empty';
  const str = schedule
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

// Per-instance in-memory state of the currently applied schedule & revision
let currentInstanceScheduleFingerprint = '';
let currentInstanceScheduleHash = '';
let lastLocalMutationTimeMs = 0;
let lastLocalMutationUpdatedAt = '';
let lastKnownCloudUpdatedAt = '';
let lastKnownRevision = 0;
let activePendingMutations = 0;
let lastLocalSaveFailed = false;
let writeQueuePromise: Promise<void> = Promise.resolve();

function nextMonotonicTimestamp(...existingIsos: Array<string | undefined | null>): string {
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

export function setLocalScheduleFingerprint(schedule: ShiftEntry[]) {
  const fp = getScheduleFingerprint(schedule);
  if (fp) {
    currentInstanceScheduleFingerprint = fp;
    currentInstanceScheduleHash = getScheduleHash(schedule);
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

async function fetchFirestoreDocREST(timeoutMs = 4000): Promise<CloudRosterState | null> {
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
      markDirectFirestoreHealthy();
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
    markDirectFirestoreHealthy();
    updateSyncDetails({ firestoreConnected: true });
    return decoded as CloudRosterState;
  } catch (err) {
    markDirectFirestoreBlocked();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function writeFirestoreDocREST(data: Record<string, any>, merge = true): Promise<boolean> {
  if (isFirestoreQuotaExhausted) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
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
    markDirectFirestoreHealthy();
    updateSyncDetails({
      firestoreConnected: true,
      lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
    });
    return true;
  } catch (err) {
    markDirectFirestoreBlocked();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function isCloudflarePagesOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname.toLowerCase().endsWith('.pages.dev');
}

function isStaticHostingOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname.toLowerCase();
  return h.endsWith('github.io') || h.endsWith('netlify.app');
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
  // On Cloudflare Pages (*.pages.dev), prefer same-origin /api/sync Pages Function unless user specified a custom non-default relay
  if (isCloudflarePagesOrigin() && (!custom || custom === DEFAULT_VERCEL_SYNC_URL) && !deadEndpointUrls.has('__local__')) {
    return '';
  }
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

    // Never let background/remote snapshots overwrite an actively in-flight local save
    if (source !== 'broadcast' && activePendingMutations > 0) {
      return;
    }

    // If our last local save failed to reach remote cloud, never silently revert user's local edits to older remote state
    if (
      source !== 'broadcast' &&
      lastLocalSaveFailed &&
      (!data.updatedAt || !lastLocalMutationUpdatedAt || data.updatedAt <= lastLocalMutationUpdatedAt)
    ) {
      return;
    }

    const incomingFp = getScheduleFingerprint(data.schedule);
    const incomingHash = getScheduleHash(data.schedule);
    const incomingMeta = getMetaHash(data);
    const incomingVersion = typeof data._version === 'number' ? data._version : 0;
    const incomingRevision = typeof data._revision === 'number' ? data._revision : 0;

    // Never allow any remote snapshot to revert a customized schedule back to the legacy 88aedc2d fallback unless explicitly reset
    if (
      incomingHash === LEGACY_STALE_SCHEDULE_HASH &&
      currentInstanceScheduleHash &&
      currentInstanceScheduleHash !== LEGACY_STALE_SCHEDULE_HASH &&
      !data._explicitReset
    ) {
      return;
    }

    // Never allow an older or equal-to-mutation snapshot to revert newer local/cloud state
    if (
      (hasReceivedAnyData || lastLocalMutationTimeMs > 0) &&
      data.updatedAt &&
      lastKnownCloudUpdatedAt &&
      data.updatedAt < lastKnownCloudUpdatedAt
    ) {
      return;
    }

    // Never allow a lower revision from an unhydrated client to overwrite a higher revision (unless explicit factory reset)
    if (
      source !== 'broadcast' &&
      lastKnownRevision > 0 &&
      incomingRevision > 0 &&
      incomingRevision < lastKnownRevision &&
      !data._explicitReset
    ) {
      return;
    }

    if (
      source !== 'broadcast' &&
      lastLocalMutationUpdatedAt &&
      data.updatedAt &&
      data.updatedAt <= lastLocalMutationUpdatedAt &&
      Boolean(incomingFp) &&
      incomingFp !== currentInstanceScheduleFingerprint
    ) {
      return;
    }

    // Protect recent local mutations for 20s against stale edge-cache reads (e.g. Worker TTL) unless strictly newer from another client
    if (
      source !== 'broadcast' &&
      lastLocalMutationTimeMs > 0 &&
      Date.now() - lastLocalMutationTimeMs < 20000 &&
      (!data.updatedAt || !lastLocalMutationUpdatedAt || data.updatedAt <= lastLocalMutationUpdatedAt)
    ) {
      return;
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
    const isNewerRevision = incomingRevision > 0 && incomingRevision > lastKnownRevision;

    if (hasReceivedAnyData && !isScheduleChanged && !isMetaChanged && !isNewerVersion && !isNewerRevision) {
      return;
    }

    if (incomingFp) {
      currentInstanceScheduleFingerprint = incomingFp;
      currentInstanceScheduleHash = incomingHash;
    }
    lastAppliedMetaHash = incomingMeta;
    if (incomingVersion > lastAppliedVersion) {
      lastAppliedVersion = incomingVersion;
    }
    if (incomingRevision > lastKnownRevision) {
      lastKnownRevision = incomingRevision;
    }
    if (data.updatedAt && (!lastKnownCloudUpdatedAt || data.updatedAt > lastKnownCloudUpdatedAt)) {
      lastKnownCloudUpdatedAt = data.updatedAt;
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
                updatedAt: new Date().toISOString(),
              } as CloudRosterState,
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

  // 1. Progressive Parallel Freshness-First Fetch across Local Server, Worker Relay & Firestore REST
  // Delivers the first reachable response immediately (so Iran users never wait 6s on blocked Firestore),
  // then upgrades seamlessly if another endpoint resolves later with a newer updatedAt/_revision.
  const fetchFromEndpoints = async (
    checkAllSources = true,
    onProgressiveCandidate?: (result: any, source: 'server' | 'firestore') => void
  ): Promise<{ result: any; source: 'server' | 'firestore' }> => {
    type Candidate = {
      result: any;
      source: 'server' | 'firestore';
      updatedAt: string;
      revision: number;
      version: number;
    };
    const tasks: Promise<Candidate | null>[] = [];
    let sawExplicitEmpty = false;
    let bestProgressiveUpdatedAt = '';

    const emitCandidate = (cand: Candidate | null) => {
      if (!cand) return cand;
      if (
        onProgressiveCandidate &&
        (!bestProgressiveUpdatedAt || cand.updatedAt >= bestProgressiveUpdatedAt)
      ) {
        bestProgressiveUpdatedAt = cand.updatedAt || bestProgressiveUpdatedAt;
        onProgressiveCandidate(cand.result, cand.source);
      }
      return cand;
    };

    const wrapServerFetch = async (base: string): Promise<Candidate | null> => {
      const json = await tryServerSyncGet(base);
      if (!json) return null;
      if (json.exists === false) {
        // Note: A cold Cloudflare Worker isolate whose upstream Firestore read timed out returns { exists: false }.
        // Never treat a Worker { exists: false } as an authoritative empty database.
        if (!base || !base.includes('.workers.dev')) {
          sawExplicitEmpty = true;
        }
        return null;
      }
      if (json.exists && json.data) {
        const candHash = getScheduleHash(json.data.schedule);
        if (
          candHash === LEGACY_STALE_SCHEDULE_HASH &&
          currentInstanceScheduleHash &&
          currentInstanceScheduleHash !== LEGACY_STALE_SCHEDULE_HASH &&
          !json.data._explicitReset
        ) {
          return null;
        }
        return emitCandidate({
          result: json,
          source: 'server',
          updatedAt: json.updatedAt || json.data?.updatedAt || '',
          revision: typeof json.data?._revision === 'number' ? json.data._revision : 0,
          version: typeof json.version === 'number' ? json.version : (json.data?._version || 0),
        });
      }
      return null;
    };

    if (!isNativeAndroid) {
      if (!isStaticHost) {
        tasks.push(wrapServerFetch(''));
      }
      const customUrl = getCustomServerUrl();
      if (customUrl && (checkAllSources || isStaticHost || deadEndpointUrls.has('__local__'))) {
        tasks.push(wrapServerFetch(customUrl));
      }
    } else {
      for (const base of getActiveServerUrls()) {
        tasks.push(wrapServerFetch(base));
      }
    }

    const shouldProbeDirectFirestore =
      !isFirestoreQuotaExhausted &&
      (!isDirectFirestoreTemporarilyBlocked() || tasks.length === 0) &&
      (checkAllSources || !currentSyncDetails.serverConnected);

    if (shouldProbeDirectFirestore) {
      tasks.push(
        fetchFirestoreDocREST(4000)
          .then((restData): Candidate | null => {
            if (!restData) {
              sawExplicitEmpty = true;
              return null;
            }
            return emitCandidate({
              result: {
                exists: true,
                modified: true,
                updatedAt: restData.updatedAt,
                data: restData,
              },
              source: 'firestore',
              updatedAt: restData.updatedAt || '',
              revision: typeof restData._revision === 'number' ? restData._revision : 0,
              version: typeof restData._version === 'number' ? restData._version : 0,
            });
          })
          .catch(() => null)
      );
    }

    const settled = await Promise.allSettled(tasks);
    const validCandidates: Candidate[] = [];
    let anyServerOk = false;
    let anyFirestoreOk = false;

    for (const item of settled) {
      if (item.status === 'fulfilled' && item.value) {
        validCandidates.push(item.value);
        if (item.value.source === 'server') anyServerOk = true;
        if (item.value.source === 'firestore') anyFirestoreOk = true;
      }
    }

    if (validCandidates.length > 0) {
      validCandidates.sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) {
          return b.updatedAt.localeCompare(a.updatedAt);
        }
        if (a.revision !== b.revision) {
          return b.revision - a.revision;
        }
        return b.version - a.version;
      });
      const best = validCandidates[0];
      updateSyncDetails({
        serverConnected: anyServerOk || currentSyncDetails.serverConnected,
        firestoreConnected: anyFirestoreOk || currentSyncDetails.firestoreConnected,
      });
      return { result: best.result, source: best.source };
    }

    // Firestore SDK getDocFromServer fallback if REST & relay failed
    if (!isFirestoreQuotaExhausted && !isDirectFirestoreTemporarilyBlocked()) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Firestore fetch timeout')), 4500)
        );
        const snap = await Promise.race([
          getDocFromServer(doc(db, ROSTER_DOC_PATH, ROSTER_DOC_ID)),
          timeoutPromise,
        ]);
        markDirectFirestoreHealthy();
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
        } else {
          markDirectFirestoreBlocked();
        }
      }
    }

    if (sawExplicitEmpty && !anyServerOk) {
      return { result: { exists: false, data: null }, source: 'firestore' };
    }

    throw new Error('All remote endpoints unreachable');
  };

  const doFetchInitial = (attempt = 1) => {
    if (isCancelled) return;
    const reqStartedAt = Date.now();
    fetchFromEndpoints(true, (resData, source) => {
      if (isCancelled || lastLocalMutationTimeMs > reqStartedAt) return;
      if (resData && resData.exists && resData.data) {
        handleIncomingData(resData.data, source, resData.data._originClientId);
      }
    })
      .then(({ result: resData, source }) => {
        if (isCancelled || lastLocalMutationTimeMs > reqStartedAt) return;
        if (resData && resData.exists && resData.data) {
          handleIncomingData(resData.data, source, resData.data._originClientId);
        } else if (!hasReceivedAnyData) {
          if (attempt < 4) {
            setTimeout(() => doFetchInitial(attempt + 1), 1800);
          } else if (onInitialEmpty) {
            onInitialEmpty();
          }
        }
      })
      .catch((err) => {
        if (isCancelled) return;
        if (currentSyncDetails.firestoreConnected || currentSyncDetails.serverConnected) {
          return;
        }
        if (!hasReceivedAnyData) {
          if (attempt < 4) {
            setTimeout(() => doFetchInitial(attempt + 1), 1800);
          } else if (onError) {
            onError(err);
          }
        }
      });
  };

  doFetchInitial(1);

  // 2. Direct Server-Sent Events (SSE) Stream — connect to local /api/sync/stream whenever local server is available
  let eventSource: EventSource | null = null;
  let sseReconnectTimer: any = null;
  const syncApiBase = getSyncApiBase();
  const canConnectLocalSSE =
    !isNativeAndroid && !isStaticHost && !isCloudflarePagesOrigin() && !deadEndpointUrls.has('__local__');
  const hasServerEndpoint =
    canConnectLocalSSE || (Boolean(syncApiBase) && !deadEndpointUrls.has(syncApiBase));

  const connectSSE = () => {
    if (isCancelled || typeof window === 'undefined' || !('EventSource' in window)) return;
    // Prefer local '/api/sync/stream' whenever available (even if customUrl is set to a Cloudflare Worker relay)
    const sseBase = canConnectLocalSSE ? '' : getSyncApiBase();
    const activeKey = sseBase || '__local__';
    if (
      (!sseBase && (isNativeAndroid || isStaticHost || isCloudflarePagesOrigin())) ||
      deadEndpointUrls.has(activeKey) ||
      sseBase.includes('.workers.dev')
    ) {
      return;
    }
    try {
      if (eventSource) {
        try {
          eventSource.close();
        } catch {}
      }
      const streamUrl = `${sseBase}/api/sync/stream`;
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
  const fetchLatestFromServer = (checkAllSources = false) => {
    if (isCancelled || activePendingMutations > 0) return;
    const activeServers = getActiveServerUrls();
    const canUseLocalServer = !isNativeAndroid && !isStaticHost && !deadEndpointUrls.has('__local__');
    if (!checkAllSources && currentSyncDetails.firestoreConnected && activeServers.length === 0 && !canUseLocalServer) {
      return;
    }
    const reqStartedAt = Date.now();
    fetchFromEndpoints(checkAllSources)
      .then(({ result: resData, source }) => {
        if (isCancelled || !resData || lastLocalMutationTimeMs > reqStartedAt || activePendingMutations > 0) return;
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
  const pollTimer = setInterval(() => fetchLatestFromServer(false), pollIntervalMs);

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
          fetchLatestFromServer(false);
          if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            try {
              navigator.serviceWorker.controller.postMessage({ type: 'BG_HEARTBEAT_PING' });
            } catch {}
          }
        }
      };
    } catch {}
  }

  // Immediate full freshness check when tab becomes active / device unlocked
  const handleVisibilityOrFocus = () => {
    fetchLatestFromServer(true);
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
  }

  // 4. Firestore direct listener attached IMMEDIATELY (no testConnection gatekeeper!)
  let firestoreUnsubscribe: Unsubscribe | null = null;
  let firestoreReconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const attachFirestoreListener = () => {
    if (isCancelled || isFirestoreQuotaExhausted) return;
    if (firestoreUnsubscribe) {
      try {
        firestoreUnsubscribe();
      } catch {}
      firestoreUnsubscribe = null;
    }
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
            if (!isCancelled && !isFirestoreQuotaExhausted) {
              if (firestoreReconnectTimer) clearTimeout(firestoreReconnectTimer);
              firestoreReconnectTimer = setTimeout(() => {
                attachFirestoreListener();
              }, 3000);
            }
          }
        }
      );
    } catch {
      updateSyncDetails({ firestoreConnected: false });
    }
  };

  attachFirestoreListener();

  return () => {
    isCancelled = true;
    if (pollTimer) clearInterval(pollTimer);
    if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
    if (firestoreReconnectTimer) clearTimeout(firestoreReconnectTimer);
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
 * Fetches latest roster state on-demand across all active endpoints (Local Server, Relay Worker, Firestore REST/SDK)
 * and picks whichever has the newest updatedAt timestamp.
 */
export async function fetchLatestCloudRosterNow(): Promise<CloudRosterState | null> {
  const isAndroid = isStandaloneAndroidRuntime();
  const isStaticHost = isStaticHostingOrigin();
  const customUrl = getCustomServerUrl();

  const candidateFetches: Promise<{ data: CloudRosterState; source: 'server' | 'firestore'; updatedAt: string } | null>[] = [];

  const fetchServerCandidate = async (base: string) => {
    const key = base || '__local__';
    if (deadEndpointUrls.has(key)) return null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6500);
      const url = base ? `${base}/api/sync?_t=${Date.now()}` : `/api/sync?_t=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      clearTimeout(timer);
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('application/json')) {
        const json = await res.json();
        if (json?.exists && json?.data) {
          updateSyncDetails({ serverConnected: true, lastSyncTime: new Date().toLocaleTimeString('fa-IR') });
          return {
            data: json.data as CloudRosterState,
            source: 'server' as const,
            updatedAt: json.updatedAt || json.data?.updatedAt || '',
          };
        }
      } else if (res.status === 402 || res.status === 404 || res.status === 410) {
        deadEndpointUrls.add(key);
      }
    } catch {}
    return null;
  };

  if (!isAndroid) {
    if (!isStaticHost) {
      candidateFetches.push(fetchServerCandidate(''));
    }
    if (customUrl) {
      candidateFetches.push(fetchServerCandidate(customUrl));
    }
  } else {
    for (const base of getActiveServerUrls()) {
      candidateFetches.push(fetchServerCandidate(base));
    }
  }

  if (!isFirestoreQuotaExhausted) {
    candidateFetches.push(
      fetchFirestoreDocREST(7000)
        .then((restData) => {
          if (!restData) return null;
          updateSyncDetails({
            firestoreConnected: true,
            lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
            channel: currentSyncDetails.serverConnected ? 'both' : 'firestore',
          });
          return {
            data: restData,
            source: 'firestore' as const,
            updatedAt: restData.updatedAt || '',
          };
        })
        .catch(() => null)
    );
  }

  const settled = await Promise.allSettled(candidateFetches);
  const valid = settled
    .filter((r): r is PromiseFulfilledResult<{ data: CloudRosterState; source: 'server' | 'firestore'; updatedAt: string } | null> => r.status === 'fulfilled' && Boolean(r.value))
    .map((r) => r.value!);

  if (valid.length > 0) {
    valid.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const best = valid[0].data;
    if (best.updatedAt && (!lastKnownCloudUpdatedAt || best.updatedAt > lastKnownCloudUpdatedAt)) {
      lastKnownCloudUpdatedAt = best.updatedAt;
    }
    if (typeof best._revision === 'number' && best._revision > lastKnownRevision) {
      lastKnownRevision = best._revision;
    }
    lastLocalSaveFailed = false;
    updateSyncDetails({ hasUnsavedChanges: false });
    return best;
  }

  if (!isFirestoreQuotaExhausted) {
    try {
      const snap = await getDocFromServer(doc(db, ROSTER_DOC_PATH, ROSTER_DOC_ID));
      if (snap.exists()) {
        const cloudData = snap.data() as CloudRosterState;
        markDirectFirestoreHealthy();
        updateSyncDetails({
          firestoreConnected: true,
          lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
          channel: currentSyncDetails.serverConnected ? 'both' : 'firestore',
          hasUnsavedChanges: false,
        });
        if (cloudData.updatedAt && (!lastKnownCloudUpdatedAt || cloudData.updatedAt > lastKnownCloudUpdatedAt)) {
          lastKnownCloudUpdatedAt = cloudData.updatedAt;
        }
        if (typeof cloudData._revision === 'number' && cloudData._revision > lastKnownRevision) {
          lastKnownRevision = cloudData._revision;
        }
        lastLocalSaveFailed = false;
        return cloudData;
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
 * Saves or updates roster data with serialized Dual Sync across BOTH Web Browser and Native Android App:
 * 1. Serializes writes via writeQueuePromise so rapid edits cannot overwrite each other out of order.
 * 2. Uses monotonic timestamps & revisions immune to device clock skew and stale-tab overwrites.
 * 3. Uses local server or relay/Firestore commit confirmation without stalling 14s when direct Firestore is blocked in Iran.
 */
export async function saveCloudRoster(data: Partial<CloudRosterState>): Promise<void> {
  // Block any accidental write of the legacy unedited 88aedc2d schedule unless explicitly resetting
  if (
    data.schedule &&
    Array.isArray(data.schedule) &&
    getScheduleHash(data.schedule) === LEGACY_STALE_SCHEDULE_HASH &&
    !data._explicitReset
  ) {
    console.warn('[CloudSync] Blocked attempt to overwrite cloud schedule with legacy fallback 88aedc2d');
    return;
  }

  const runWrite = async (): Promise<void> => {
    activePendingMutations++;
    lastLocalMutationTimeMs = Date.now();

    try {
      // If this browser tab hasn't hydrated from the cloud yet (lastKnownRevision === 0),
      // do a fast pre-write fetch so we never write _revision: 1 over an existing cloud state!
      let remotePreState: CloudRosterState | null = null;
      if ((!lastKnownCloudUpdatedAt || lastKnownRevision === 0) && !data._explicitReset) {
        try {
          remotePreState = await Promise.race([
            fetchLatestCloudRosterNow(),
            new Promise<null>((r) => setTimeout(() => r(null), 3000)),
          ]);
          if (remotePreState) {
            if (remotePreState.updatedAt && (!lastKnownCloudUpdatedAt || remotePreState.updatedAt > lastKnownCloudUpdatedAt)) {
              lastKnownCloudUpdatedAt = remotePreState.updatedAt;
            }
            if (typeof remotePreState._revision === 'number' && remotePreState._revision > lastKnownRevision) {
              lastKnownRevision = remotePreState._revision;
            }
          }
        } catch {}
      }

      const baseUpdatedAt = lastKnownCloudUpdatedAt || undefined;
      const now = nextMonotonicTimestamp(
        lastKnownCloudUpdatedAt,
        lastLocalMutationUpdatedAt,
        remotePreState?.updatedAt
      );
      const nextRevision = Math.max(lastKnownRevision, remotePreState?._revision || 0) + 1;

      lastLocalMutationTimeMs = Date.now();
      lastLocalMutationUpdatedAt = now;
      lastKnownCloudUpdatedAt = now;
      lastKnownRevision = nextRevision;

      const mergedData: Partial<CloudRosterState> = {
        ...(remotePreState || {}),
        ...data,
      };
      // If caller did not explicitly edit schedule and remotePreState has a non-legacy schedule, keep remote schedule
      if (
        !data._scheduleEdited &&
        remotePreState?.schedule &&
        Array.isArray(remotePreState.schedule) &&
        remotePreState.schedule.length > 0 &&
        getScheduleHash(remotePreState.schedule) !== LEGACY_STALE_SCHEDULE_HASH
      ) {
        mergedData.schedule = remotePreState.schedule;
      }

      if (mergedData.schedule && Array.isArray(mergedData.schedule)) {
        setLocalScheduleFingerprint(mergedData.schedule);
      }

      const payload = cleanFirestoreData({
        ...mergedData,
        updatedAt: now,
        _revision: nextRevision,
        ...(baseUpdatedAt ? { _baseUpdatedAt: baseUpdatedAt } : {}),
        _userEdited: true,
        _clientBuild: CLIENT_BUILD_ID,
        _originClientId: CLIENT_ID,
      });

      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('shiftflow_updated_at', now);
        } catch {}
      }

      // Broadcast to other tabs in the same browser immediately (0ms latency)
      broadcastLocalStateChange(payload);

      const isAndroid = isStandaloneAndroidRuntime();
      const isStaticHost = isStaticHostingOrigin();
      const isPagesHost = isCloudflarePagesOrigin();
      const customUrl = getCustomServerUrl();
      const hasLocalServer = !isAndroid && !isStaticHost && !deadEndpointUrls.has('__local__');
      const targetUrls: string[] = [];

      if (isAndroid) {
        targetUrls.push(...getActiveServerUrls().map((base) => `${base}/api/sync`));
      } else {
        if (hasLocalServer) {
          targetUrls.push('/api/sync');
        }
        if (
          customUrl &&
          !deadEndpointUrls.has(customUrl) &&
          (!isPagesHost || deadEndpointUrls.has('__local__') || customUrl !== DEFAULT_VERCEL_SYNC_URL)
        ) {
          targetUrls.push(`${customUrl}/api/sync`);
        }
      }

      // 1. Direct Firestore Write (fast 4.5s timeout; skipped if blocked recently AND server/relay channels exist)
      const writeToFirestore = async (): Promise<boolean> => {
        if (isFirestoreQuotaExhausted) return false;
        if (isDirectFirestoreTemporarilyBlocked() && targetUrls.length > 0) {
          return false;
        }
        try {
          const restOk = await writeFirestoreDocREST(payload, true);
          if (restOk) {
            markDirectFirestoreHealthy();
            updateSyncDetails({
              firestoreConnected: true,
              lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
              channel: currentSyncDetails.serverConnected ? 'both' : 'firestore',
            });
            return true;
          }
        } catch {
          // If direct REST timed out/failed and we have relay/server endpoints, avoid stalling another 6.5s on SDK
          if (targetUrls.length > 0) {
            return false;
          }
        }

        if (isFirestoreQuotaExhausted || (isDirectFirestoreTemporarilyBlocked() && targetUrls.length > 0)) {
          return false;
        }
        try {
          await Promise.race([
            setDoc(doc(db, ROSTER_DOC_PATH, ROSTER_DOC_ID), payload, { merge: true }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Firestore SDK write timeout')), 4500)
            ),
          ]);
          markDirectFirestoreHealthy();
          updateSyncDetails({
            firestoreConnected: true,
            lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
            channel: currentSyncDetails.serverConnected ? 'both' : 'firestore',
          });
          return true;
        } catch (err: any) {
          const msg = String(err?.message || err);
          if (msg.includes('Missing or insufficient permissions') || err?.code === 'permission-denied') {
            handleFirestoreError(err, OperationType.WRITE, `${ROSTER_DOC_PATH}/${ROSTER_DOC_ID}`);
          }
          if (
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('resource-exhausted') ||
            err?.code === 'resource-exhausted' ||
            err?.code === 8
          ) {
            isFirestoreQuotaExhausted = true;
            updateSyncDetails({ isQuotaExhausted: true, firestoreConnected: false });
          } else {
            markDirectFirestoreBlocked();
          }
          return false;
        }
      };

      const postToServer = async (
        url: string
      ): Promise<{ isLocal: boolean; ok: boolean; conflict?: boolean; firestorePersisted?: boolean }> => {
        const isLocal = url === '/api/sync';
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: payload, clientId: CLIENT_ID }),
            signal: controller.signal,
          });
          if (r.status === 402 || r.status === 404 || r.status === 410) {
            const base = url.replace(/\/api\/sync$/, '') || '__local__';
            deadEndpointUrls.add(base);
            return { isLocal, ok: false };
          }
          if (r.status === 409) {
            try {
              const conflictJson = await r.json();
              if (conflictJson?.updatedAt && (!lastKnownCloudUpdatedAt || conflictJson.updatedAt > lastKnownCloudUpdatedAt)) {
                lastKnownCloudUpdatedAt = conflictJson.updatedAt;
              }
              if (typeof conflictJson?.data?._revision === 'number' && conflictJson.data._revision > lastKnownRevision) {
                lastKnownRevision = conflictJson.data._revision;
              }
            } catch {}
            return { isLocal, ok: false, conflict: true };
          }
          if (!r.ok) {
            return { isLocal, ok: false };
          }
          const json = await r.json();
          if (json?.updatedAt && typeof json.updatedAt === 'string') {
            if (!lastKnownCloudUpdatedAt || json.updatedAt > lastKnownCloudUpdatedAt) {
              lastKnownCloudUpdatedAt = json.updatedAt;
            }
            if (!lastLocalMutationUpdatedAt || json.updatedAt > lastLocalMutationUpdatedAt) {
              lastLocalMutationUpdatedAt = json.updatedAt;
            }
            if (typeof localStorage !== 'undefined') {
              try {
                localStorage.setItem('shiftflow_updated_at', json.updatedAt);
              } catch {}
            }
          }
          if (typeof json?.data?._revision === 'number' && json.data._revision > lastKnownRevision) {
            lastKnownRevision = json.data._revision;
          }
          updateSyncDetails({
            serverConnected: true,
            lastSyncTime: new Date().toLocaleTimeString('fa-IR'),
            channel: currentSyncDetails.firestoreConnected ? 'both' : 'server',
          });
          return {
            isLocal,
            ok: true,
            firestorePersisted: typeof json?.firestorePersisted === 'boolean' ? json.firestorePersisted : undefined,
          };
        } catch {
          return { isLocal, ok: false };
        } finally {
          clearTimeout(timer);
        }
      };

      // Launch direct Firestore + server/relay writes; resolve promptly once durable cloud persistence is confirmed
      const firestorePromise = writeToFirestore();
      const serverPromises = targetUrls.map(postToServer);

      const durableConfirmation = new Promise<{
        firestoreOk: boolean;
        serverResults: Array<{ isLocal: boolean; ok: boolean; conflict?: boolean; firestorePersisted?: boolean }>;
      }>((resolve) => {
        let settledCount = 0;
        const total = 1 + serverPromises.length;
        let resolved = false;
        let fsOk = false;
        const srvRes: Array<{ isLocal: boolean; ok: boolean; conflict?: boolean; firestorePersisted?: boolean }> = [];

        const tryFinish = () => {
          if (resolved) return;
          const anyConflict = srvRes.some((s) => s.conflict);
          if (anyConflict) {
            resolved = true;
            resolve({ firestoreOk: false, serverResults: srvRes });
            return;
          }
          const remoteRelayOk = srvRes.some((s) => !s.isLocal && s.ok);
          const localServerCloudOk = srvRes.some(
            (s) => s.isLocal && s.ok && (s.firestorePersisted === true || isFirestoreQuotaExhausted)
          );
          const allServersSettled = srvRes.length >= serverPromises.length;
          if (
            fsOk ||
            (localServerCloudOk && (remoteRelayOk || allServersSettled)) ||
            (!hasLocalServer && remoteRelayOk) ||
            settledCount >= total
          ) {
            resolved = true;
            resolve({ firestoreOk: fsOk, serverResults: srvRes });
          }
        };

        firestorePromise
          .then((ok) => {
            fsOk = ok;
            settledCount++;
            tryFinish();
          })
          .catch(() => {
            settledCount++;
            tryFinish();
          });

        serverPromises.forEach((p) =>
          p
            .then((res) => {
              srvRes.push(res);
              settledCount++;
              tryFinish();
            })
            .catch(() => {
              srvRes.push({ isLocal: false, ok: false });
              settledCount++;
              tryFinish();
            })
        );
      });

      const { firestoreOk, serverResults } = await durableConfirmation;
      lastLocalMutationTimeMs = Date.now();

      const hasConflict = serverResults.some((s) => s.conflict);
      const remoteRelayOk = serverResults.some((s) => !s.isLocal && s.ok);
      const localServerWithCloudOk = serverResults.some(
        (s) => s.isLocal && s.ok && (s.firestorePersisted === true || isFirestoreQuotaExhausted)
      );
      const anyServerOk = serverResults.some((s) => s.ok);

      if (hasConflict || (!firestoreOk && !remoteRelayOk && !localServerWithCloudOk)) {
        lastLocalSaveFailed = true;
        updateSyncDetails({
          hasUnsavedChanges: true,
          ...(!anyServerOk && !hasConflict ? { serverConnected: false, firestoreConnected: false, channel: 'offline' } : {}),
        });
        throw new Error(
          hasConflict
            ? 'Stale client conflict rejected by server'
            : 'Cloud persistence did not complete across remote endpoints'
        );
      }

      lastLocalSaveFailed = false;
      updateSyncDetails({ hasUnsavedChanges: false });
    } finally {
      activePendingMutations = Math.max(0, activePendingMutations - 1);
    }
  };

  // Serialize writes so rapid successive edits always arrive in exact order
  const chained = writeQueuePromise.then(runWrite, runWrite);
  writeQueuePromise = chained.catch(() => {});
  return chained;
}

/**
 * Overwrites entire cloud roster with fresh initial data across both channels.
 */
export async function resetCloudRoster(data: CloudRosterState): Promise<void> {
  const now = nextMonotonicTimestamp(lastKnownCloudUpdatedAt, lastLocalMutationUpdatedAt);
  lastLocalMutationTimeMs = Date.now();
  lastLocalMutationUpdatedAt = now;
  lastKnownCloudUpdatedAt = now;
  if (data.schedule) {
    setLocalScheduleFingerprint(data.schedule);
  }

  const nextRevision = lastKnownRevision + 1;
  lastKnownRevision = nextRevision;
  const payload = cleanFirestoreData({
    ...data,
    updatedAt: now,
    _revision: nextRevision,
    _explicitReset: true,
    _userEdited: true,
    _clientBuild: CLIENT_BUILD_ID,
    _originClientId: CLIENT_ID,
  });

  broadcastLocalStateChange(payload);

  activePendingMutations++;
  try {
    const ops: Promise<any>[] = [];
    if (!isFirestoreQuotaExhausted) {
      ops.push(
        writeFirestoreDocREST(payload, false).catch(() =>
          setDoc(doc(db, ROSTER_DOC_PATH, ROSTER_DOC_ID), payload).catch(() => false)
        )
      );
    }

    const isAndroid = isStandaloneAndroidRuntime();
    const isStaticHost = isStaticHostingOrigin();
    const isPagesHost = isCloudflarePagesOrigin();
    const customUrl = getCustomServerUrl();
    const targetUrls: string[] = [];
    if (isAndroid) {
      targetUrls.push(...getActiveServerUrls().map((base) => `${base}/api/sync/reset`));
    } else {
      if (!isStaticHost && !deadEndpointUrls.has('__local__')) {
        targetUrls.push('/api/sync/reset');
      }
      if (
        customUrl &&
        !deadEndpointUrls.has(customUrl) &&
        (!isPagesHost || deadEndpointUrls.has('__local__') || customUrl !== DEFAULT_VERCEL_SYNC_URL)
      ) {
        targetUrls.push(`${customUrl}/api/sync/reset`);
      }
    }

    for (const url of targetUrls) {
      ops.push(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: payload }),
        })
      );
    }

    await Promise.allSettled(ops);
    lastLocalSaveFailed = false;
  } finally {
    activePendingMutations = Math.max(0, activePendingMutations - 1);
    lastLocalMutationTimeMs = Date.now();
  }
}
