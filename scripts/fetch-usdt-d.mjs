// 生成 data/usdt-dominance.json：USDT 市值占全加密市场百分比（日频）。
//
// 三源重建（均为公开免费接口）：
//   1. CMC data-api v4：全球总市值 + BTC 市值（周频官方口径，
//      与 TradingView CRYPTOCAP:TOTAL 同源）
//   2. DefiLlama stablecoincharts：USDT 全链流通市值（日频）
//   3. CoinMetrics community：BTC 流通市值（日频）——把周频总市值按
//      「BTC 占比」插值重建为日频（BTC 占比在周内是慢变量）
// 重建口径说明见 data/usdt-dominance.json 的 note 字段。
//
// 运行（三选一，视网络环境）：
//   node scripts/fetch-usdt-d.mjs
//   NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 node scripts/fetch-usdt-d.mjs
// 需 Node ≥ 21。
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'usdt-dominance.json');
const HEADERS = { Accept: 'application/json, text/plain, */*', platform: 'web' };
const DAY = 86400;

const j = (u) => fetch(u, { headers: HEADERS }).then((r) => {
  if (!r.ok) throw new Error(`${u.slice(0, 60)}... HTTP ${r.status}`);
  return r.json();
});
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);

// ── 1. CMC：周频总市值与 BTC 市值 ──
const cmc = await j('https://api.coinmarketcap.com/data-api/v4/global-metrics/quotes/historical?convertId=2781&range=all');
const weeks = (cmc.data.points || []).map((p) => ({
  ts: Number(p.timestamp),
  mcap: p.marketCap,
  btc: p.btcValue,
})).filter((p) => p.mcap > 0 && p.btc > 0).sort((a, b) => a.ts - b.ts);
console.error(`CMC 周点: ${weeks.length}（${iso(weeks[0].ts)} → ${iso(weeks.at(-1).ts)}）`);

// ── 2. DefiLlama：USDT 日频流通市值 ──
const llama = await j('https://stablecoins.llama.fi/stablecoincharts/all?stablecoin=1');
const usdt = llama.map((p) => [Number(p.date), Object.values(p.totalCirculatingUSD).reduce((a, b) => a + b, 0)])
  .sort((a, b) => a[0] - b[0]);
console.error(`DefiLlama USDT 日点: ${usdt.length}（${iso(usdt[0][0])} → ${iso(usdt.at(-1)[0])}）`);

// ── 3. CoinMetrics：BTC 日频流通市值（翻页拉全）──
const btc = [];
let url = 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMrktCurUSD&page_size=5000&start_time=2019-01-01';
while (url) {
  const page = await j(url);
  for (const r of page.data) btc.push([Math.floor(new Date(r.time).getTime() / 1000), Number(r.CapMrktCurUSD)]);
  url = page.next_page_token
    ? `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMrktCurUSD&page_size=5000&start_time=2019-01-01&page=${page.next_page_token}`
    : null;
}
btc.sort((a, b) => a[0] - b[0]);
console.error(`CoinMetrics BTC 日点: ${btc.length}（${iso(btc[0][0])} → ${iso(btc.at(-1)[0])}）`);

// ── 重建：日频总市值 = BTC 日市值 ÷ BTC 占比（周频线性插值）──
const interp = (tsList, vals, ts) => {
  if (ts <= tsList[0]) return ts === tsList[0] ? vals[0] : null;
  if (ts >= tsList.at(-1)) return ts === tsList.at(-1) ? vals.at(-1) : null;
  let lo = 0, hi = tsList.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tsList[m] <= ts) lo = m; else hi = m; }
  const f = (ts - tsList[lo]) / (tsList[hi] - tsList[lo]);
  return vals[lo] + (vals[hi] - vals[lo]) * f;
};
const near = (tsList, vals, ts, tol) => {
  let lo = 0, hi = tsList.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tsList[m] <= ts) lo = m; else hi = m; }
  const a = lo, b = Math.min(lo + 1, tsList.length - 1);
  const pick = Math.abs(tsList[a] - ts) <= Math.abs(tsList[b] - ts) ? a : b;
  return Math.abs(tsList[pick] - ts) <= tol ? vals[pick] : null;
};

const wkTs = weeks.map((w) => w.ts);
const wkShare = weeks.map((w) => w.btc / w.mcap);
const usdtTs = usdt.map((p) => p[0]);
const usdtVal = usdt.map((p) => p[1]);
const btcTs = btc.map((p) => p[0]);
const btcVal = btc.map((p) => p[1]);

const series = [];
for (let ts = weeks[0].ts; ts <= Math.min(weeks.at(-1).ts, btc.at(-1)[0]); ts += DAY) {
  const btcCap = near(btcTs, btcVal, ts, DAY * 3);
  const share = interp(wkTs, wkShare, ts);
  const usdtCap = near(usdtTs, usdtVal, ts, DAY * 8);
  if (btcCap === null || share === null || usdtCap === null || share <= 0) continue;
  const total = btcCap / share; // 重建日频总市值
  series.push([ts, Math.round((usdtCap / total) * 100 * 1000) / 1000]);
}
console.error(`USDT.D 日频序列: ${series.length} 点（${iso(series[0][0])} → ${iso(series.at(-1)[0])}）`);

const peak = series.reduce((a, b) => (b[1] > a[1] ? b : a));
console.error(`历史峰值: ${peak[1]}% @ ${iso(peak[0])}（TV 同源参考 9.486% @ 2022-12）`);
console.error(`触及 ≥9%: ${series.filter((s) => s[1] >= 9).length} 天`);

writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  source: 'coinmarketcap data-api v4 (total market cap, weekly) + defillama stablecoincharts (USDT, daily) + coinmetrics community (BTC market cap, daily)',
  note: 'USDT 市值占全加密市场百分比（日频）。总市值由 CMC 周频官方口径按 BTC 占比插值重建为日频；USDT 市值取 DefiLlama 全链日频。2022 年早期样本与 TradingView 显示可能存在 ≤1pp 差异（周内跳变插值误差）。更新：node scripts/fetch-usdt-d.mjs',
  series,
}));
console.error(`→ ${OUT}`);
