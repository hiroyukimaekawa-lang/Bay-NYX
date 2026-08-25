/**
 * microCMS API 共通呼び出しモジュール (Netlify Functions 用)
 */

const PAGE_LIMIT = 100;
const MAX_CONTENTS = 1000;

const CACHE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=60, stale-while-revalidate=60',
};

async function fetchMicroCMS(endpoint) {
  const serviceDomain = process.env.MICROCMS_SERVICE_DOMAIN;
  const apiKey = process.env.MICROCMS_API_KEY;

  // 環境変数が設定されていない場合は 500 を返し、フロントエンドのフォールバックを発動させる
  if (!serviceDomain || !apiKey) {
    console.warn('[microcms] MICROCMS_SERVICE_DOMAIN または MICROCMS_API_KEY が未設定です。');
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ error: 'env_missing' }),
    };
  }

  const baseUrl = `https://${encodeURIComponent(serviceDomain)}.microcms.io/api/v1/${encodeURIComponent(endpoint)}`;
  const headers = { 'X-MICROCMS-API-KEY': apiKey };

  const fetchPage = async (offset) => {
    const url = `${baseUrl}?orders=sortOrder,key&limit=${PAGE_LIMIT}&offset=${offset}`;
    return await fetch(url, { headers });
  };

  try {
    const res = await fetchPage(0);
    if (!res.ok) {
      console.warn(`[microcms] ${endpoint} fetch error: status ${res.status}`);
      return {
        statusCode: 502,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify({ error: 'upstream_error', status: res.status }),
      };
    }

    const data = await res.json();

    // 100件を超える場合のページネーション取得
    if (Array.isArray(data.contents) && Number(data.totalCount) > data.contents.length) {
      const total = Math.min(Number(data.totalCount), MAX_CONTENTS);
      while (data.contents.length < total) {
        const nextRes = await fetchPage(data.contents.length);
        if (!nextRes.ok) break;
        const page = await nextRes.json();
        if (!page || !Array.isArray(page.contents) || page.contents.length === 0) break;
        data.contents = data.contents.concat(page.contents);
      }
    }

    return {
      statusCode: 200,
      headers: CACHE_HEADERS,
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.warn(`[microcms] ${endpoint} fetch failed:`, error ? error.message : error);
    return {
      statusCode: 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ error: 'fetch_failed' }),
    };
  }
}

module.exports = {
  fetchMicroCMS,
};
