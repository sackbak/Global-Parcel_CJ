// Vercel KV 기반 데이터 API
// GET  /api/data         → { shared: {...}, pages: { korea: {...}, ... } }
// POST /api/data         → { scope, sectionId, cellId, value } 단일 셀 저장

import { kv } from '@vercel/kv';

const PAGE_IDS = ['korea', 'vietnam', 'thailand', 'taiwan', 'usa', 'japan', 'china'];

export default async function handler(req, res) {
  // CORS (서브도메인에서 부르거나 할 때 대비)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const shared = (await kv.get('shared')) || {};
      const pages = {};
      for (const id of PAGE_IDS) {
        pages[id] = (await kv.get(`page:${id}`)) || {};
      }
      // 클라이언트 캐싱 끔
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ shared, pages, ts: Date.now() });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { scope, sectionId, cellId, value } = body || {};
      if (!scope || !cellId) {
        return res.status(400).json({ error: 'missing scope or cellId' });
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
