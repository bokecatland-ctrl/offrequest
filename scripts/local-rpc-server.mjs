// 開発・動作確認用：ローカルの PostgreSQL に対して、Supabase（PostgREST）の
// RPC 呼び出し（POST /rest/v1/rpc/<関数名>）だけを真似する小さなサーバー。
// 本番では使わない（本番は Supabase が同じ役割をする）。
//
//   PGHOST=... PGPORT=... PGDATABASE=offrequest node scripts/local-rpc-server.mjs
//   .env.local に VITE_SUPABASE_URL=http://localhost:54321 / VITE_SUPABASE_ANON_KEY=local
import http from 'node:http';
import pg from 'pg';

const PORT = Number(process.env.RPC_PORT || 54321);
const pool = new pg.Pool({ user: process.env.PGUSER || 'postgres', database: process.env.PGDATABASE || 'offrequest' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function send(res, status, body) {
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204);
    const m = req.url && req.url.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (req.method !== 'POST' || !m || m[1].startsWith('_')) return send(res, 404, { message: 'not found' });

    let raw = '';
    for await (const chunk of req) raw += chunk;
    const args = raw ? JSON.parse(raw) : {};
    const names = Object.keys(args);
    if (!names.every((n) => /^p_[a-z0-9_]+$/.test(n))) return send(res, 400, { message: 'bad args' });

    const sql = `select public.${m[1]}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role anon');
      const result = await client.query(sql, names.map((n) => args[n]));
      await client.query('commit');
      send(res, 200, result.rows[0]?.r ?? null);
    } catch (e) {
      await client.query('rollback').catch(() => {});
      send(res, 400, { message: e.message, code: e.code, hint: e.hint ?? null, details: e.detail ?? null });
    } finally {
      client.release();
    }
  })
  .listen(PORT, () => console.log(`local rpc server: http://localhost:${PORT}`));
