// Vercel KV 기반 데이터 API
// GET  /api/data         → { shared: {...}, pages: { korea: {...}, ... } }
// POST /api/data         → { scope, sectionId, cellId, value } 단일 셀 저장

import { kv } from '@vercel/kv';

const PAGE_IDS = ['korea', 'vietnam', 'thailand', 'taiwan', 'usa', 'japan', 'china'];

// 허용 Origin (배포 URL + alias). 환경변수로도 추가 가능.
const ALLOWED_ORIGINS = [
  'https://cj-lmd-report.vercel.app',
  'https://cj-lmd-report-sackbaks-projects.vercel.app',
];

function isAllowedOrigin(origin, referer) {
  // 추가 환경변수에서 허용 origin 받기 (콤마 구분)
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const list = [...ALLOWED_ORIGINS, ...extra];

  const src = origin || referer || '';
  if (!src) return false;
  return list.some(allowed => src.startsWith(allowed));
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';

  // 자기 도메인에서 호출 안 되면 거부 (외부 봇 차단)
  if (!isAllowedOrigin(origin, referer)) {
    return res.status(403).json({ error: 'forbidden' });
  }

  // CORS 응답 (Same-Origin이므로 사실 필수는 아니지만 명시)
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const shared = (await kv.get('shared')) || {};
      const pages = {};
      for (const id of PAGE_IDS) {
        pages[id] = (await kv.get(`page:${id}`)) || {};
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ shared, pages, ts: Date.now() });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { scope, sectionId, cellId, value } = body || {};
      if (!scope || !cellId) {
        return res.status(400).json({ error: 'missing scope or cellId' });
      }
      // 셀 값 길이 제한 (한 셀에 100KB 이상 못 박게 = 악용 방지)
      if (typeof value === 'string' && value.length > 100000) {
        return res.status(413).json({ error: 'value too large' });
      }
      const key = scope === 'shared' ? 'shared' : `page:${sectionId}`;
      const current = (await kv.get(key)) || {};
      current[cellId] = value;
      await kv.set(key, current);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error('API error', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
