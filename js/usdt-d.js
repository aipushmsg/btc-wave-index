// USDT.D 实时层：内置快照做底 + 运行时自动延伸尾部到当天，无需手动跑脚本。
//
// 选源原则：浏览器直连可达 + CORS 开放（国内无代理也能用）。离线脚本用的
// CMC（无 CORS 放行）、DefiLlama / CoinGecko（国内直连被墙）都不满足，故运行时用：
//   1. CoinMetrics community：USDT、BTC 日频流通市值 + BTC 流通量（滞后约 1 天）
//   2. CoinPaprika global：当前 BTC 占比（实时，作为插值终点锚）
// 历史段没有免费且直连可达的「全市场总市值」源，尾部用 BTC 占比插值重建：
// 占比是慢变量，在「快照末段反推的隐含占比」与「当前占比」之间线性过渡（与离线
// 脚本把周频占比插值成日频同一思路）。起点锚由快照本身反推，且锚点与尾部共用同一
// USDT 市值源——不同源的市值口径差（如 CoinMetrics USDT 偏高于 DefiLlama）在锚点
// 处自动抵消，尾部因此与快照无缝衔接、并保持在快照的 CMC/TradingView 刻度上。
// 当日值：USDT 取最新日频值（流通量日内几乎不变），BTC 用页面实时价格 × 最新流通量
// 折算，使当日读数随行情跳动。任一关键源失败即抛错，由调用方回退快照。
import { DAY } from './config.js';

const CM = 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics';
const PAP = 'https://api.coinpaprika.com/v1';

const getJSON = (url) => fetch(url, { signal: AbortSignal.timeout(15000) })
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 60)}`); return r.json(); });

// CoinMetrics 翻页拉全（窗口通常 < 5000 行，单页即止；保留循环以防快照极旧）
async function cmSeries(asset, metrics, startISO) {
  const rows = [];
  let url = `${CM}?assets=${asset}&metrics=${metrics}&page_size=5000&start_time=${startISO}`;
  for (let page = 0; url && page < 8; page++) {
    const j = await getJSON(url);
    rows.push(...(j.data || []));
    url = j.next_page_token
      ? `${CM}?assets=${asset}&metrics=${metrics}&page_size=5000&start_time=${startISO}&next_page_token=${j.next_page_token}`
      : null;
  }
  return rows;
}

const dayOf = (iso) => Math.floor(new Date(iso).getTime() / 1000 / DAY) * DAY;
const round3 = (v) => Math.round(v * 1000) / 1000;

// snapshot: [[unix秒, %]]（升序）；livePrice: 页面实时 BTC 价格（可空）。
// 返回 { series, asOf, source }。
export async function fetchUsdtDLive(snapshot, livePrice) {
  const now = Math.floor(Date.now() / 1000);
  const today = Math.floor(now / DAY) * DAY;
  const endTs = snapshot.length ? snapshot[snapshot.length - 1][0] : today - 30 * DAY;
  const startISO = new Date((endTs - 10 * DAY) * 1000).toISOString().slice(0, 10);

  const [usdtRows, btcRows, pap] = await Promise.all([
    cmSeries('usdt', 'CapMrktCurUSD', startISO),
    cmSeries('btc', 'CapMrktCurUSD,SplyCur', startISO),
    getJSON(`${PAP}/global`).catch(() => null), // 占比终点锚可选，失败则用起点锚持平
  ]);

  const usdt = new Map();
  for (const r of usdtRows) usdt.set(dayOf(r.time), Number(r.CapMrktCurUSD));
  const btc = new Map();
  for (const r of btcRows) btc.set(dayOf(r.time), { mcap: Number(r.CapMrktCurUSD), supply: Number(r.SplyCur) });
  if (!usdt.size || !btc.size) throw new Error('CoinMetrics USDT/BTC 市值为空');

  const domNow = Number(pap?.bitcoin_dominance_percentage);
  const merged = new Map(snapshot);

  // 起点锚：由快照末段反推隐含 BTC 占比（dom = BTC市值 × USDT.D ÷ USDT市值），
  // 取末 7 个可用日均值降噪。锚自快照而来 → 尾部与快照连续、无接缝。
  const samples = [];
  for (let i = snapshot.length - 1; i >= 0 && samples.length < 7; i--) {
    const [ts, pct] = snapshot[i];
    const u = usdt.get(ts);
    const b = btc.get(ts)?.mcap;
    if (pct > 0 && Number.isFinite(u) && Number.isFinite(b)) samples.push((b * pct) / u);
  }
  const domAnchor = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : domNow;
  const domEnd = Number.isFinite(domNow) && domNow > 0 ? domNow : domAnchor;
  if (!Number.isFinite(domAnchor) || domAnchor <= 0) throw new Error('无法确定 BTC 占比锚点');

  // 尾部：快照末 → CoinMetrics 最新日（约昨天），占比线性过渡
  const lastCM = Math.max([...usdt.keys()].at(-1), [...btc.keys()].at(-1));
  const span = Math.max(lastCM - endTs, DAY);
  for (let ts = endTs + DAY; ts <= lastCM; ts += DAY) {
    const u = usdt.get(ts);
    const b = btc.get(ts)?.mcap;
    if (!Number.isFinite(u) || !Number.isFinite(b) || b <= 0) continue;
    const dom = domAnchor + (domEnd - domAnchor) * ((ts - endTs) / span);
    if (dom > 0) merged.set(ts, round3((u * dom) / b));
  }

  // 当日：USDT 取最新日频值，BTC 用实时价格 × 最新流通量折算（无实时价则用最新市值）
  const uToday = usdt.get(lastCM);
  const bLatest = btc.get(lastCM);
  let bToday = bLatest?.mcap;
  if (Number.isFinite(livePrice) && livePrice > 0 && bLatest?.supply > 0) bToday = livePrice * bLatest.supply;
  if (Number.isFinite(uToday) && Number.isFinite(bToday) && bToday > 0 && domEnd > 0) {
    merged.set(today, round3((uToday * domEnd) / bToday));
  }

  const series = [...merged.entries()].sort((a, b) => a[0] - b[0]);
  if (!series.length) throw new Error('USDT.D 实时序列为空');
  return { series, asOf: series[series.length - 1][0], source: 'coinmetrics+coinpaprika' };
}