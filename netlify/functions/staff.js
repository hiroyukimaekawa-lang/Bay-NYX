/**
 * Netlify Function: /staff
 * microCMS の staff API を安全にプロキシして取得します。
 */

const { fetchMicroCMS } = require('./lib/microcms');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'method_not_allowed' }),
    };
  }

  return await fetchMicroCMS('staff');
};
