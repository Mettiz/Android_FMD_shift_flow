/**
 * Cloudflare Pages Function: /api/sync, /api/sync/reset, /api/sync/stream, /api/sync?action=health
 * Proxies ShiftFlow roster reads & writes to Google Cloud Firestore REST API
 * directly from Cloudflare's edge network on the same *.pages.dev domain.
 */

const FIRESTORE_DOC_URL =
  'https://firestore.googleapis.com/v1/projects/beaming-source-hcbh2/databases/ai-studio-fmdproductionshi-3f0608ec-b995-44d1-a9c8-f98c589f0e16/documents/roster_state/current';

let memoryCache = null;
let lastReadTime = 0;
const CACHE_TTL_MS = 5000;

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
  const res = await fetch(FIRESTORE_DOC_URL, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET ${res.status}`);
  return decodeDoc(await res.json());
}

async function writeToFirestore(data, merge = true) {
  let url = FIRESTORE_DOC_URL;
  if (merge) {
    const mask = Object.keys(data)
      .filter((k) => data[k] !== undefined)
      .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
      .join('&');
    if (mask) url += `?${mask}`;
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(encodeDoc(data)),
  });
  if (!res.ok) {
    throw new Error(`Firestore PATCH ${res.status}`);
  }
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cache-Control, Accept',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Type': 'application/json; charset=utf-8',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const isHealth =
    url.pathname.includes('/health') || url.searchParams.get('action') === 'health';
  const isReset =
    url.pathname.includes('/reset') || url.searchParams.get('action') === 'reset';
  const isStream =
    url.pathname.includes('/stream') ||
    request.headers.get('accept') === 'text/event-stream';

  if (isHealth) {
    return new Response(
      JSON.stringify({
        status: 'ok',
        platform: 'cloudflare-pages-function',
        directRest: true,
        cachedItems: memoryCache && Array.isArray(memoryCache.schedule) ? memoryCache.schedule.length : 0,
        serverTime: new Date().toISOString(),
      }),
      { status: 200, headers: cors }
    );
  }

  if (isStream && request.method === 'GET') {
    if (!memoryCache) {
      try {
        memoryCache = await fetchFromFirestore();
        lastReadTime = Date.now();
      } catch {}
    }
    return new Response(
      `data: ${JSON.stringify({ type: 'init', data: memoryCache, version: 1 })}\n\n`,
      {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
        },
      }
    );
  }

  if (request.method === 'GET') {
    const clientSince = url.searchParams.get('since');
    const now = Date.now();

    if (!memoryCache || now - lastReadTime > CACHE_TTL_MS) {
      try {
        const fresh = await fetchFromFirestore();
        if (fresh) {
          memoryCache = fresh;
          lastReadTime = now;
        }
      } catch {}
    }

    if (memoryCache) {
      const updatedAt = memoryCache.updatedAt || '';
      if (clientSince && updatedAt && updatedAt === clientSince) {
        return new Response(
          JSON.stringify({ exists: true, modified: false, version: 1, updatedAt }),
          { status: 200, headers: cors }
        );
      }
      return new Response(
        JSON.stringify({
          exists: true,
          modified: true,
          version: 1,
          updatedAt,
          data: memoryCache,
        }),
        { status: 200, headers: cors }
      );
    }

    return new Response(JSON.stringify({ exists: false, data: null }), {
      status: 200,
      headers: cors,
    });
  }

  if (request.method === 'POST') {
    let body = {};
    try {
      body = await request.json();
    } catch {}

    const incoming = (body && body.data) || body || {};
    const now = new Date().toISOString();

    let baseState = memoryCache;
    if (!isReset && (!baseState || !Array.isArray(baseState.schedule))) {
      try {
        const fresh = await fetchFromFirestore();
        if (fresh) baseState = fresh;
      } catch {}
    }

    const firestorePatch = {
      ...incoming,
      updatedAt: now,
    };
    const payload = {
      ...(isReset ? {} : baseState || {}),
      ...firestorePatch,
    };

    if (isReset || Array.isArray(payload.schedule)) {
      memoryCache = payload;
      lastReadTime = Date.now();
    }

    try {
      await writeToFirestore(isReset ? payload : firestorePatch, !isReset);
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: String((err && err.message) || err) }),
        { status: 500, headers: cors }
      );
    }

    return new Response(
      JSON.stringify({ success: true, version: 1, updatedAt: now, data: payload }),
      { status: 200, headers: cors }
    );
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: cors,
  });
}
