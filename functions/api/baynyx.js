/**
 * microCMS プロキシ (Cloudflare Pages Functions)
 *
 * このファイルの場所がそのままURLになります。
 *   functions/api/baynyx.js  →  https://<サイト>/api/baynyx
 *
 * フロントエンド（cms-content.js）は /api/baynyx を呼ぶだけで、
 * microCMSのAPIキーはサーバー側にとどまり、ブラウザには一切送られません。
 *
 * Cloudflare Pages の管理画面で設定する環境変数:
 *   MICROCMS_API_KEY        … 必須。デフォルト値は持たせない。
 *   MICROCMS_SERVICE_DOMAIN … 任意。未設定なら 'l9pawk28o1'
 *   MICROCMS_ENDPOINT       … 任意。未設定なら 'baynyx'
 */

const DEFAULT_SERVICE_DOMAIN = 'l9pawk28o1';
const DEFAULT_ENDPOINT = 'baynyx';

// microCMSへのリクエスト回数を抑えるためのキャッシュ設定
const CACHE_CONTROL = 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400';

function json(status, body, cacheControl) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl || 'no-store',
    },
  });
}

// GET のみ公開する（onRequestGet という名前がGETだけに対応する）
export async function onRequestGet(context) {
  const env = context.env || {};

  const apiKey = env.MICROCMS_API_KEY;
  const serviceDomain = env.MICROCMS_SERVICE_DOMAIN || DEFAULT_SERVICE_DOMAIN;
  const endpoint = env.MICROCMS_ENDPOINT || DEFAULT_ENDPOINT;

  // APIキー未設定でもサイトが壊れないよう、エラーを返してフロント側のフォールバックに任せる
  if (!apiKey) {
    console.warn('MICROCMS_API_KEY が設定されていません。');
    return json(503, { error: 'not_configured' });
  }

  const url =
    'https://' +
    encodeURIComponent(serviceDomain) +
    '.microcms.io/api/v1/' +
    encodeURIComponent(endpoint) +
    '?limit=100';

  try {
    const response = await fetch(url, {
      headers: { 'X-MICROCMS-API-KEY': apiKey },
    });

    if (!response.ok) {
      console.warn('microCMS API error: ' + response.status);
      return json(502, { error: 'upstream_error', status: response.status });
    }

    const data = await response.json();

    return json(200, data, CACHE_CONTROL);
  } catch (error) {
    console.warn('microCMS fetch failed:', error && error.message ? error.message : error);
    return json(502, { error: 'fetch_failed' });
  }
}

// onRequestGet だけを公開しているため、POST/PUT/DELETE などは
// Cloudflare Pages 側が自動的に 405 を返します。
