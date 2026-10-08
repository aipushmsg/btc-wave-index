// 枢轴计算与标注生成。
// 牛顶 = 搜索窗口内最高价那天，熊底 = 窗口内最低价那天（用户确认的画法）。
// 横轴以区块高度为唯一坐标系：所有标注位置都是高度，日期仅作刻度辅助显示。
import {
  PIVOT_WINDOWS, HALVING_INTERVAL, WAVE_BULL_HALF,
  EXTEND_MARGIN_BLOCKS, BLOCKS_PER_DAY, TRADE_WINDOW_DAYS, COLORS,
} from './config.js';
import { heightAt, timeAtHeight } from './blocks.js';
import { t } from './i18n.js';
import { PhaseArea } from './primitives/phase-area.js';
import { VertLine } from './primitives/vert-line.js';
import { HalvingTrade } from './primitives/halving-trade.js';

// YYYY/MM/DD（与 main.js 全站日期格式一致），减半标签的日期行用
const fmtYMD = (ts) => {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`;
};

// 减半买卖窗口跨度（区块）：500 天 × 144 块/天 = 72,000 块，
// 与高度轴同一坐标系，整除无余数
const TRADE_WIN_BLOCKS = TRADE_WINDOW_DAYS * BLOCKS_PER_DAY;

// 高度 → 当日收盘价：经真实链上时间锚点反推日期，在真实日线之间
// 线性插值。数据边界外（更早历史 / 未来推演）返回 null，
// 买卖窗口直角无锚可定即整体不画
function priceAtHeight(candles, h) {
  const n = candles.length;
  if (n === 0) return null;
  const ts = timeAtHeight(h);
  if (ts < candles[0].time || ts > candles[n - 1].time) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= ts) lo = mid;
    else hi = mid;
  }
  const a = candles[lo];
  const b = candles[hi];
  const f = (ts - a.time) / ((b.time - a.time) || 1);
  return a.close + f * (b.close - a.close);
}

export function computePivots(candles) {
  const pivots = [];
  let from = PIVOT_WINDOWS[0].from ?? candles[0].time;
  for (const w of PIVOT_WINDOWS) {
    let best = null;
    for (const c of candles) {
      if (c.time < from || c.time > w.to) continue;
      if (
        best === null ||
        (w.type === 'top' ? c.high > best.high : c.low < best.low)
      ) best = c;
    }
    if (!best) throw new Error(`枢轴窗口内没有数据：${w.type} → ${w.to}`);
    pivots.push({
      type: w.type,
      time: best.time,
      price: w.type === 'top' ? best.high : best.low,
    });
    from = best.time;
  }
  return pivots;
}

// 由枢轴推出全部标注 primitive，按类别分组返回（牛熊区着色与减半线
// 各有独立的显隐开关）。todayH：当前链上高度；horizon：未来视界高度；
// dailyCandles：真实日线（无 whitespace 占位），供买卖窗口直角锚价。
// 返回 { bandPrims, halvingPrims, phaseBandPrims, phaseHalvingPrims, extendTo, meta }。
export function buildAnnotations(pivots, todayH, horizon = null, dailyCandles = []) {
  const bandPrims = [];         // 主图：牛熊夹心填充 + 类型标签
  const halvingPrims = [];      // 主图：减半竖线 + 竖排标签
  const phaseBandPrims = [];    // 副图对应两类
  const phaseHalvingPrims = [];

  // 枢轴坐标：区块高度
  const pts = pivots.map((p) => ({ ...p, pos: heightAt(p.time) }));
  const todayPos = todayH;

  // 进行中熊市的预测终点 = 牛顶高度 + 历史熊市块数均值
  //（排除不合规律的第一轮熊市；供顶栏周期状态与右侧留白使用）
  const lastTop = pts.at(-1);
  if (lastTop.type !== 'top') throw new Error('PIVOT_WINDOWS 应以 top 结尾（进行中周期的牛顶）');
  const bearSpans = [];
  for (let i = 2; i + 1 < pts.length; i += 2) bearSpans.push(pts[i + 1].pos - pts[i].pos);
  const bearBlocks = Math.round(bearSpans.reduce((a, b) => a + b, 0) / bearSpans.length);
  const predictedEnd = lastTop.pos + bearBlocks;

  // 今日位置由常驻的当前区块引导线表达（DOM，见 main.js updateNowGuide），
  // 图内不再挂「今日」文本标签

  // 预测终点已过时仍保留右侧留白（以「今日」为准）；有未来视界时延伸到视界
  const extendTo = Math.max(
    horizon ?? 0,
    Math.max(predictedEnd, todayPos) + EXTEND_MARGIN_BLOCKS,
  );

  // 减半竖线：按 210,000 区块网格从首次减半（210,000）铺到视界为止
  //（高度是协议常量，全部实线）。主图与 BTC 指数副图各挂一条，
  // 视觉上贯穿两个面板；先于夹心填充挂载 = 画在最底层，任何内容
  // 都不被它遮挡；沿线竖排标签
  for (let i = 0; i < 10; i++) {
    const hgt = (i + 1) * HALVING_INTERVAL;
    if (hgt > extendTo) break;
    halvingPrims.push(new VertLine({
      time: hgt, color: COLORS.halving,
      // 「第 n 次减半」+ 日期（高度→日期插值，过去为真实链上时间）
      label: t('halvingTag', i + 1, fmtYMD(timeAtHeight(hgt))),
      labelColor: COLORS.halvingLabel,
    }));
    phaseHalvingPrims.push(new VertLine({ time: hgt, color: COLORS.halving }));

    // 减半买卖窗口直角（经典周期图语言）：绿 = 减半前 500 天买入、
    // 红 = 减半后 500 天卖出。窗口时间由区块高度精确确定（500 天 =
    // 72,000 块），锚价在真实日线范围内时画实线直角、竖边锚定当日
    // 收盘价；锚价在数据边界之外（第一轮的 2011 年更早历史 / 尚未
    // 走到的未来窗口）时降级为虚线推演直角——窗口照标、价位留白，
    // 与 BTC 指数「实线已发生、虚线推演」同一语言。卖出窗口超出未来
    // 视界时连推演也不画（图上没有那段时间轴）
    const tradeLabel = t('windowDays', TRADE_WINDOW_DAYS);
    const buyH = hgt - TRADE_WIN_BLOCKS;
    const buyPrice = priceAtHeight(dailyCandles, buyH);
    halvingPrims.push(new HalvingTrade({
      mode: 'buy',
      halvingH: hgt,
      anchorH: buyH,
      price: buyPrice,
      label: tradeLabel,
      color: COLORS.tradeBuy,
      projected: buyPrice === null,
    }));
    const sellH = hgt + TRADE_WIN_BLOCKS;
    // 卖出窗口超出未来视界时图上没有那段时间轴，连推演也不画
    if (sellH <= extendTo) {
      const sellPrice = priceAtHeight(dailyCandles, sellH);
      halvingPrims.push(new HalvingTrade({
        mode: 'sell',
        halvingH: hgt,
        anchorH: sellH,
        price: sellPrice,
        label: tradeLabel,
        color: COLORS.tradeSell,
        projected: sellPrice === null,
      }));
    }
  }

  // 牛熊区间：由 BTC 周期指数（纯区块制）推导——牛市 = 减半 ± 78,750 区块
  //（指数上行段），其余为熊市（下行段）。着色为「夹心填充」：主图从价格
  // 收盘连线向下、副图从面板顶边向下到 BTC 指数线，两块上下拼接成
  // 上缘贴价格线、下缘贴指数线的连续区域；无价格的时段（更早历史 /
  // 未来推演）主图满高填充，价格实时右进逐步「吃掉」色块
  //（负高度不存在，区间起点钳制在 0）；牛市/熊市标签画在填充区内部
  const bandAnchors = [];
  for (let k = 0; k <= 12; k++) {
    bandAnchors.push({ h: k * HALVING_INTERVAL - WAVE_BULL_HALF, bull: true });
    bandAnchors.push({ h: k * HALVING_INTERVAL + WAVE_BULL_HALF, bull: false });
  }
  for (let i = 0; i + 1 < bandAnchors.length; i++) {
    const from = Math.max(bandAnchors[i].h, 0);
    const to = bandAnchors[i + 1].h;
    if (to <= 0 || from > extendTo) continue;
    const isBull = bandAnchors[i].bull;
    const fill = isBull ? COLORS.bandFillBull : COLORS.bandFillBear;
    bandPrims.push(new PhaseArea({
      from,
      to,
      fill,
      mode: 'price',
      label: isBull ? t('bull') : t('bear'),
      labelColor: isBull ? COLORS.bullLabel : COLORS.bearLabel,
    }));
    phaseBandPrims.push(new PhaseArea({ from, to, fill, mode: 'wave' }));
  }

  return {
    bandPrims,
    halvingPrims,
    phaseBandPrims,
    phaseHalvingPrims,
    extendTo,
    meta: { topPos: lastTop.pos, todayPos, predictedEnd },
  };
}
