// 入口编排：内置快照立即上屏 → 后台拉实时尾部 → 原地升级；
// 页面 UI（区块主轴 + 底部「高度/≈日期」双行刻度轴、分桶/主题/坐标/标注开关、
// OHLC 读数、周期状态栏、顶部标签轴）
import {
  DAY, BLOCK_BUCKETS, HALVING_INTERVAL, WAVE_BULL_HALF, COLORS, FONT, FONT_MONO, setTheme,
  WAVE_COLOR_STOPS, waveColor, USDT_D_BUY_LEVEL, USDT_D_STRONG_LEVEL,
} from './config.js';
import { createChartAndSeries, applyChartTheme, setLogScale } from './chart.js';
import {
  loadSnapshot, fetchBitstampLive, fetchCoinbaseFallback,
  mergeCandles, fillGaps,
} from './data.js';
import {
  loadHeightAnchors, fetchTipAnchor, heightAt, timeAtHeight,
  aggregateByBlocks, extendBlocks, prependBlocks, waveIndexAt, waveHorizonHeight,
} from './blocks.js';
import { computePivots, buildAnnotations } from './pivots.js';
import { t, setLang, I18N } from './i18n.js';
import { setSeriesData, timeToLogical, logicalToX } from './primitives/base.js';
import { UsdtBuyZone } from './primitives/usdt-zone.js';

const $ = (id) => document.getElementById(id);
const fmtDate = (t) => new Date(t * 1000).toISOString().slice(0, 10);
// 全站统一的日期显示格式：YYYY/MM/DD
const fmtYMD = (t) => {
  const d = new Date(t * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`;
};
// 粗刻度用的月份格式：YYYY/MM
const fmtYM = (t) => {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const fmtPrice = (p) => (p >= 100 ? Math.round(p).toLocaleString('en-US') : p.toFixed(2));
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const fmtPct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

const THEME_KEY = 'btc-theme';
const LANG_KEY = 'btc-lang';
// 界面设置持久化：用户改过的坐标/图表类型/分桶粒度/标注显隐记在
// localStorage（与主题/语言同一机制），下次打开直接恢复个性化状态
const SCALE_KEY = 'btc-scale';
const STYLE_KEY = 'btc-style';
const TF_KEY = 'btc-tf';
// 标注显隐拆成两个独立开关：减半日 / 牛熊市（旧的 wolfy-annot 总开关
// 作为两者缺省值的兜底，老用户的选择不丢失）
const ANNOT_HALVING_KEY = 'btc-annot-halving';
const ANNOT_BANDS_KEY = 'btc-annot-bands';
const USDTD_KEY = 'btc-usdtd'; // USDT.D 窗格显隐（独立开关，默认显示）

// BTC 色谱与 waveColor 定义在 config.js（与夹心填充/色标共用同一映射）

// 读数文字用的 BTC 色：与折线/色标同一色谱（同一数值同一颜色）；
// 浅色主题下压暗一档——色谱中段的黄绿在白底上几乎不可读
function waveTextColor(v) {
  const c = waveColor(v);
  if (document.documentElement.dataset.theme !== 'light') return c;
  const [r, g, b] = c.match(/\d+/g).map(Number);
  const k = 0.72;
  return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
}

function showNotice(text) {
  $('notice-text').textContent = text;
  $('notice').hidden = false;
}
$('notice-close').addEventListener('click', () => { $('notice').hidden = true; });

async function init() {
  // ── 主题与语言初始化（在建图之前） ──
  let themeName = localStorage.getItem(THEME_KEY) || 'dark';
  setTheme(themeName);
  document.documentElement.dataset.theme = themeName;
  setLang(localStorage.getItem(LANG_KEY) || 'en'); // 默认英文界面
  $('loading-text').textContent = t('loading');

  // 右侧色标：按同一份色谱生成渐变，保证与折线逐点颜色严格一致
  $('ws-bar').style.background = `linear-gradient(to top, ${
    WAVE_COLOR_STOPS.map(([p, c]) => `rgb(${c[0]}, ${c[1]}, ${c[2]}) ${p * 100}%`).join(', ')
  })`;

  // ── 状态 ──
  let attached = [];       // 当前挂载的标注 primitive（主图）
  let attachedPhase = [];  // 当前挂载的副图标注（贯穿的色带与减半线）
  // 最近一次构建的标注，按类别分组（减半日与牛熊市独立显隐）
  let built = { bands: [], halvings: [] };
  let builtPhase = { bands: [], halvings: [] };
  // 当前开关状态下应挂载的集合；减半线在前 = 先挂 = 画在最底层
  const currentMainPrims = () => [
    ...(halvingOn ? built.halvings : []),
    ...(bandsOn ? built.bands : []),
  ];
  const currentPhasePrims = () => [
    ...(halvingOn ? builtPhase.halvings : []),
    ...(bandsOn ? builtPhase.bands : []),
  ];
  // 默认初始状态：标注开启、对数坐标、BTC 着色、144 区块（日）；
  // 用户改过则从 localStorage 恢复（存的值非法时回落默认）
  const legacyAnnot = localStorage.getItem('wolfy-annot');
  let halvingOn = (localStorage.getItem(ANNOT_HALVING_KEY) ?? legacyAnnot) !== '0';
  let bandsOn = (localStorage.getItem(ANNOT_BANDS_KEY) ?? legacyAnnot) !== '0';
  let phaseOn = true;      // BTC 指数副图窗格显示中
  let logOn = localStorage.getItem(SCALE_KEY) !== 'linear';
  const savedStyle = localStorage.getItem(STYLE_KEY);
  // 'candles' | 'line' | 'wave'，默认 BTC 着色
  let chartStyle = ['candles', 'line', 'wave'].includes(savedStyle) ? savedStyle : 'wave';
  const savedTf = localStorage.getItem(TF_KEY);
  // 分桶粒度键：day=144区块 week=1,008区块 month=4,368区块
  let timeframe = BLOCK_BUCKETS[savedTf] ? savedTf : 'day';
  let daily = [];          // fillGaps 后的日线（枢轴/统计的数据源）
  let dailyReal = [];      // 仅真实日线
  let bars = [];           // 按块分桶的 bars + whitespace（图表数据源，time=桶起始高度）
  let pivots = [];
  let meta = null;         // { topPos, todayPos, predictedEnd }（单位：高度）
  let idxCache = null;
  let tipHeight = null;    // 当前链上高度（后台获取 + 轮询）
  let livePrice = null;    // 实时价格（轮询 Bitstamp ticker，仅供顶栏）
  let watermark = null;
  let waveNow = null;      // 当前（今日）BTC 指数值，十字线移开时回落显示
  let usdtdOn = localStorage.getItem(USDTD_KEY) !== '0'; // USDT.D 窗格显示中（默认开）
  let usdtRaw = [];        // USDT.D 原始序列（[[unix秒, %]]，快照加载后固定）
  let usdtdSeries = [];    // 对齐到当前分桶网格后的序列（render 内重建）
  let usdtdNow = null;     // 最新 USDT.D 读数
  let usdtdZonePrim = null;      // 买入区色带（随语言/窗格重建）
  let usdtdZoneAttached = false; // 色带当前是否挂在系列上
  let usdtdPlBuy = null;         // 9% / 9.5% 阈值线（创建一次，随窗格显隐）
  let usdtdPlStrong = null;
  let usdtdMarkersPlugin = null; // 触及标记插件（v5 createSeriesMarkers）

  const LWC = window.LightweightCharts;
  const { chart, series, lineSeries, waveLine, phaseSolid, phaseDashed, usdtdLine } = createChartAndSeries($('chart'));
  let attachedHost = series; // 标注当前挂载的价格系列（随展示模式切换迁移）
  const styleHost = () => (chartStyle === 'line' ? lineSeries : chartStyle === 'wave' ? waveLine : series);
  // 初始可见性与默认展示模式对齐（chart.js 里 K 线是建图默认）
  series.applyOptions({ visible: chartStyle === 'candles' });
  lineSeries.applyOptions({ visible: chartStyle === 'line' });
  waveLine.applyOptions({ visible: chartStyle === 'wave' });
  if (!logOn) setLogScale(chart, false); // 持久化为线性时建图后立刻套用

  // 绘图区宽度。不能用 timeScale().width()：内置时间轴已隐藏，它返回 0
  function paneWidth() {
    try {
      return chart.paneSize().width;
    } catch {
      return $('chart').clientWidth;
    }
  }

  // 价格轴在左侧：logicalToX 给出的是面板内坐标，所有 DOM 覆盖元素
  //（底轴刻度/浮标、引导线、读数行）定位时都要加上左轴宽度
  function paneLeft() {
    try {
      return chart.priceScale('left').width() || 0;
    } catch {
      return 0;
    }
  }

  // ── 底部区块刻度轴（主行：高度；副行：对应≈日期） ──
  const blockAxis = $('block-axis');
  const bxCursor = $('bx-cursor');
  const TICK_STEPS = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000];

  // 逻辑坐标 → 高度（bars 反查 + 桶内插值），用于计算可见高度范围
  function heightAtLogical(l) {
    if (bars.length < 2) return null;
    const i = Math.max(0, Math.min(bars.length - 2, Math.floor(l)));
    const t0 = bars[i].time;
    const t1 = bars[i + 1].time;
    return t0 + (l - i) * (t1 - t0);
  }

  // 当前可见范围的刻度高度：底部区块轴与图内垂直网格线共用同一套
  function computeAxisTicks() {
    const range = chart.timeScale().getVisibleLogicalRange();
    const width = paneWidth();
    if (!range || !width) return null;
    const hFrom = heightAtLogical(range.from);
    const hTo = heightAtLogical(range.to);
    if (hFrom === null || hTo === null || hTo <= hFrom) return null;
    const pxPerBlock = width / (hTo - hFrom);
    const step = TICK_STEPS.find((s) => s * pxPerBlock >= 96) ?? TICK_STEPS.at(-1);
    const ticks = [];
    // 负高度不存在：刻度从区块 0 起
    for (let h = Math.max(0, Math.ceil(hFrom / step) * step); h <= hTo; h += step) ticks.push(h);
    return { ticks, step };
  }

  function renderBlockAxis() {
    const width = paneWidth();
    const res = computeAxisTicks();
    if (!res) return;
    const fmtTickDate = res.step >= 20000 ? fmtYM : fmtYMD; // 粗刻度只标到月
    const pl = paneLeft();
    for (const el of [...blockAxis.querySelectorAll('.bx-label, .bx-date, .bx-tick')]) el.remove();
    for (const h of res.ticks) {
      const x = logicalToX(chart, timeToLogical(h));
      if (x === null || x < 0 || x > width) continue;
      const tick = document.createElement('i');
      tick.className = 'bx-tick';
      tick.style.left = `${pl + x}px`;
      const label = document.createElement('span');
      label.className = 'bx-label';
      label.textContent = fmtInt(h);
      label.style.left = `${pl + x}px`;
      const date = document.createElement('span');
      date.className = 'bx-date';
      date.textContent = `≈ ${fmtTickDate(timeAtHeight(h))}`;
      date.style.left = `${pl + x}px`;
      blockAxis.append(tick, label, date);
    }
    updateNowGuide();
  }

  // 当前区块引导线 + 底轴高度数值牌（与 y 轴价格引导线对称，常驻显示）
  const nowLine = $('now-line');
  const bxNow = $('bx-now');

  function updateNowGuide() {
    const h = meta?.todayPos;
    const width = paneWidth();
    const x = h != null ? logicalToX(chart, timeToLogical(h)) : null;
    if (x === null || x < 0 || x > width) {
      nowLine.hidden = true;
      bxNow.hidden = true;
      return;
    }
    const pl = paneLeft();
    nowLine.style.left = `${pl + x}px`;
    nowLine.style.borderColor = COLORS.today;
    nowLine.hidden = false;
    // 与十字线浮标同格式（高度 ≈ 日期）；不用 title——
    // pointer-events:none 的元素 tooltip 永远弹不出来
    bxNow.textContent = `${fmtInt(h)} ≈ ${fmtYMD(timeAtHeight(h))}`;
    bxNow.hidden = false;
    // 贴近左右边缘时钳制在可视范围内，不被拦腰裁掉
    const bw = bxNow.offsetWidth;
    bxNow.style.left = `${pl + Math.max(bw / 2, Math.min(width - bw / 2, x))}px`;
  }

  // 十字线在底轴上的浮标：高度 ≈ 日期（负高度不存在，不显示）
  function updateAxisCursor(h) {
    if (h === null || h < 0) {
      bxCursor.hidden = true;
      return;
    }
    const x = logicalToX(chart, timeToLogical(h));
    const width = paneWidth();
    if (x === null || x < 0 || x > width) {
      bxCursor.hidden = true;
      return;
    }
    bxCursor.textContent = `${fmtInt(h)} ≈ ${fmtYMD(timeAtHeight(h))}`;
    bxCursor.hidden = false;
    // 贴近左右边缘时钳制在可视范围内，不被拦腰裁掉
    const cw = bxCursor.offsetWidth;
    bxCursor.style.left = `${paneLeft() + Math.max(cw / 2, Math.min(width - cw / 2, x))}px`;
  }

  chart.timeScale().subscribeVisibleLogicalRangeChange(renderBlockAxis);
  window.addEventListener('resize', renderBlockAxis);

  // ── BTC 指数副图窗格与 USDT.D 窗格的显隐 ──
  // 两个副图窗格独立开关、自由组合。LWC 对空面板自动回收，面板索引
  // 因此是动态的（隐藏 BWI 后第三面板会前移成 1 号），所以重排时先把
  // 全部系列退回主面板、再按目标布局逐个入位，而不是维护固定索引。
  const phaseBtn = $('phase-toggle');
  const phaseLegend = $('phase-legend');
  const usdtdBtn = $('usdtd-toggle');
  const usdtdLegend = $('usdtd-legend');
  function positionPhaseToggle() {
    const hostH = $('chart').clientHeight;
    phaseBtn.style.right = '8px'; // 价格轴在左侧，右缘无轴
    let top = hostH - 28; // 收起态：贴图表右下角
    if (phaseOn) {
      try {
        // BWI 窗格顶 = 主图高度（三窗格下也成立，不再依赖 hostH 差值）
        top = chart.panes()[0].getHeight() + 5; // 面板顶 + 分隔条
      } catch {
        try {
          const p0 = chart.paneSize(0).height;
          const p1 = chart.paneSize(1).height;
          top = p0 + Math.max(0, hostH - p0 - p1) + 5;
        } catch { /* 布局未就绪 */ }
      }
    }
    phaseBtn.style.top = `${top}px`;
    // 读数行贴面板左缘（左侧价格轴之右），与面板顶保持 10px（top 已含 +5）
    const inset = paneLeft() + 14;
    $('legend').style.left = `${inset}px`;
    phaseLegend.style.left = `${inset}px`;
    phaseLegend.hidden = !phaseOn;
    if (phaseOn) phaseLegend.style.top = `${top + 5}px`;
    positionUsdtdToggle();
    updateNowGuide(); // 面板高度变化（拖分隔条/显隐副图）时同步重定位标记点
  }
  // USDT.D 开关/标题行的定位：窗格顶部 = 其上方各面板高度之和
  function positionUsdtdToggle() {
    const hostH = $('chart').clientHeight;
    usdtdBtn.style.right = '8px';
    let top = hostH - 28; // 收起态：贴图表右下角
    if (usdtdOn) {
      try {
        const panes = chart.panes();
        const idx = phaseOn ? 2 : 1; // 面板索引随 BWI 显隐动态变化
        let y = 0;
        for (let i = 0; i < idx && i < panes.length; i++) y += panes[i].getHeight();
        top = y + 5;
      } catch { /* 布局未就绪 */ }
    }
    usdtdBtn.style.top = `${top}px`;
    const inset = paneLeft() + 14;
    usdtdLegend.style.left = `${inset}px`;
    usdtdLegend.hidden = !usdtdOn;
    if (usdtdOn) usdtdLegend.style.top = `${top + 5}px`;
  }
  // 面板高度变化（拖分隔条/窗口缩放/显隐切换）都会引起画布尺寸变化
  const paneObserver = new ResizeObserver(() => positionPhaseToggle());
  function observePaneCanvases() {
    paneObserver.disconnect();
    for (const cv of $('chart').querySelectorAll('canvas')) paneObserver.observe(cv);
  }
  observePaneCanvases();
  positionPhaseToggle();

  function relayoutPanes() {
    // 先全部退回主面板并隐藏（避免同面板叠加），再按目标布局入位
    phaseSolid.applyOptions({ visible: false });
    phaseDashed.applyOptions({ visible: false });
    usdtdLine.applyOptions({ visible: false });
    phaseSolid.moveToPane(0);
    phaseDashed.moveToPane(0);
    usdtdLine.moveToPane(0);
    let pane = 1;
    if (phaseOn) {
      phaseSolid.moveToPane(pane);
      phaseDashed.moveToPane(pane);
      phaseSolid.applyOptions({ visible: true });
      phaseDashed.applyOptions({ visible: true });
      phaseSolid.priceScale().applyOptions({
        mode: LWC.PriceScaleMode.Normal,
        scaleMargins: { top: 0.06, bottom: 0.05 },
      });
      pane++;
    }
    if (usdtdOn) {
      usdtdLine.moveToPane(pane);
      usdtdLine.applyOptions({ visible: true });
      usdtdLine.priceScale().applyOptions({
        mode: LWC.PriceScaleMode.Normal,
        scaleMargins: { top: 0.08, bottom: 0.06 },
      });
      // 买入区随窗格恢复重新挂载（隐藏窗格时已摘下，不能画进主图）
      if (usdtdZonePrim && !usdtdZoneAttached) {
        usdtdLine.attachPrimitive(usdtdZonePrim);
        usdtdZoneAttached = true;
      }
      pane++;
    }
    try {
      const panes = chart.panes();
      panes[0].setStretchFactor(4);
      for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);
    } catch (e) { console.warn('面板高度设置失败（不影响功能）：', e); }
  }

  function setPhaseVisible(on) {
    phaseOn = on;
    relayoutPanes();
    phaseBtn.classList.toggle('active', on);
    phaseLegend.hidden = !on;
    requestAnimationFrame(() => {
      observePaneCanvases(); // 面板画布重建后重新观察
      positionPhaseToggle();
    });
  }

  function setUsdtdVisible(on) {
    usdtdOn = on;
    localStorage.setItem(USDTD_KEY, on ? '1' : '0');
    relayoutPanes();
    usdtdBtn.classList.toggle('active', on);
    usdtdLegend.hidden = !on;
    requestAnimationFrame(() => {
      observePaneCanvases();
      positionPhaseToggle();
    });
  }

  phaseBtn.addEventListener('click', () => setPhaseVisible(!phaseOn));
  usdtdBtn.addEventListener('click', () => setUsdtdVisible(!usdtdOn));
  usdtdBtn.classList.toggle('active', usdtdOn); // 持久化状态回放（默认显示）
  relayoutPanes(); // 初始按持久化状态摆位：确保各系列可见性与所在面板正确

  function makeWatermark() {
    try {
      watermark?.detach();
      const [big, small] = t('watermark');
      // 标题行大号无衬线（界面文字），作者行等宽字体
      //（@handle 是标识符，走数据字体）；两行同一透明度。
      // 作者行字号按实测文本宽度缩放，与标题行渲染宽度对齐
      let authorSize = 17;
      if (small) {
        const mctx = document.createElement('canvas').getContext('2d');
        mctx.font = `bold 58px ${FONT}`;
        const tw = mctx.measureText(big).width;
        mctx.font = `17px ${FONT_MONO}`;
        const aw = mctx.measureText(small).width;
        if (tw > 0 && aw > 0) authorSize = Math.round(17 * (tw / aw));
      }
      watermark = LWC.createTextWatermark(chart.panes()[0], {
        horzAlign: 'center',
        vertAlign: 'center',
        lines: [
          {
            text: big,
            color: COLORS.watermark,
            fontSize: 58,
            fontStyle: 'bold',
            fontFamily: FONT,
          },
          ...(small ? [{
            text: small,
            color: COLORS.watermark,
            fontSize: authorSize,
            fontFamily: FONT_MONO,
            lineHeight: Math.max(46, Math.round(authorSize * 1.4)),
          }] : []),
        ],
      });
    } catch (e) {
      console.warn('水印创建失败（不影响功能）：', e);
      watermark = null;
    }
  }

  // 主图价格读数（BTC/USD 右侧）：跟随十字线，移开时回落为实时价
  function updateLegendPrice(v = null) {
    const p = v ?? livePrice ?? dailyReal.at(-1)?.close;
    $('legend-price').textContent = p != null ? fmtPrice(p) : '';
  }

  // 副图标题行（DOM，与主图 OHLC 读数同一套排版）：名称 + 实时读数。
  // 读数跟随十字线，移开时回落为当前值
  function updateWaveTitle(v = waveNow) {
    // 名称与主图「BTC/USD」同款系列标识样式（加粗主文字色）
    const name = `<b>${t('paneTitleName')}</b>`;
    if (v === null) {
      phaseLegend.innerHTML = name;
      return;
    }
    phaseLegend.innerHTML =
      `${name}<b class="wave-text" style="color: ${waveTextColor(v)}">${v.toFixed(3)}</b>`;
  }

  // USDT.D 标题行：名称 + 当前值；进入买入区时追加醒目提示
  function updateUsdtdTitle(v = usdtdNow) {
    const name = `<b>USDT.D</b>`;
    if (v === null) {
      usdtdLegend.innerHTML = name;
      return;
    }
    const inZone = v >= USDT_D_BUY_LEVEL;
    usdtdLegend.innerHTML =
      `${name}<b style="color: ${COLORS.usdtd}; margin-left: 12px;">${v.toFixed(2)}%</b>`
      + (inZone ? `<b class="usdtd-alert" style="color: ${COLORS.usdtdBuyText}">${t('usdtdAlert')}</b>` : '');
  }

  // 高度 → USDT.D 读数：二分取最近的数据点，超出 2.5 天视为无覆盖
  function usdtdAtHeight(h) {
    if (!usdtdSeries.length) return null;
    let lo = 0;
    let hi = usdtdSeries.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (usdtdSeries[m].time <= h) lo = m;
      else hi = m;
    }
    const a = usdtdSeries[lo];
    const b = usdtdSeries[hi];
    const p = Math.abs(a.time - h) <= Math.abs(b.time - h) ? a : b;
    return Math.abs(p.time - h) <= 360 ? p.value : null;
  }

  // ── 渲染管线 ──
  // newRawDaily 为 null 时复用现有日线（分桶/主题切换）；
  // 枢轴基于日线计算，图表数据按当前粒度分桶（time = 桶起始高度）
  function render(newRawDaily, { fit = false } = {}) {
    if (newRawDaily) {
      daily = fillGaps(newRawDaily);
      dailyReal = daily.filter((c) => c.open !== undefined);
      pivots = computePivots(daily);
    }
    // 未来视界：延伸到「下下个」理论熊底，铺出完整的下一轮周期
    //（未来的减半区块与 BTC 周期都是可直接推算的）
    const hNow = tipHeight ?? heightAt(dailyReal.at(-1).time + DAY);
    const horizonH = waveHorizonHeight(hNow);
    const bucket = BLOCK_BUCKETS[timeframe];
    // 真实日线传给标注构建：减半买卖窗口直角要按买卖日收盘价锚定
    const ann = buildAnnotations(pivots, hNow, horizonH, dailyReal);
    // 横轴覆盖 [区块 0, 未来视界]：价格数据之前与之后都用 whitespace 占位
    bars = extendBlocks(prependBlocks(aggregateByBlocks(daily, bucket), bucket), ann.extendTo, bucket);
    meta = ann.meta;
    series.setData(bars);
    // 折线/着色系列取收盘价，时间键与 K 线完全一致（不向时间轴引入新点位）；
    // 着色模式逐点上色：颜色 = 该处 BTC 指数（蓝 0 → 红 1）
    const realBars = bars.filter((b) => b.open !== undefined);
    lineSeries.setData(realBars.map((b) => ({ time: b.time, value: b.close })));
    waveLine.setData(realBars.map((b) => ({
      time: b.time,
      value: b.close,
      color: waveColor(waveIndexAt(b.time)),
    })));
    setSeriesData(bars);
    // BTC 周期指数：高度的纯函数，按 bars 的桶起始高度采样。
    // 实线 = 已发生，虚线 = 未来段；逐点上色 = 与着色模式同一色谱（蓝 0 → 红 1）
    const solidData = [];
    const dashedData = [];
    for (const b of bars) {
      const v = waveIndexAt(b.time);
      (b.time <= ann.meta.todayPos ? solidData : dashedData)
        .push({ time: b.time, value: v, color: waveColor(v) });
    }
    if (solidData.length && dashedData.length) dashedData.unshift(solidData.at(-1));
    phaseSolid.setData(solidData);
    phaseDashed.setData(dashedData);
    // USDT.D：日历时间 → 高度 → 对齐到当前分桶网格（与折线/着色系列
    // 同一时间键，不向时间轴引入新点位——否则 LWC 的逻辑索引会漂移，
    // 视口意外滚动）；时间键 = bars 的桶起始高度，同桶取最后写入
    usdtdSeries = [];
    if (usdtRaw.length && bucket) {
      const byBar = new Map();
      for (const [ts, v] of usdtRaw) {
        const b = Math.floor(heightAt(ts) / bucket) * bucket;
        byBar.set(b, v);
      }
      usdtdSeries = [...byBar.entries()]
        .map(([time, value]) => ({ time, value }))
        .sort((a, b) => a.time - b.time);
    }
    // 触及标记与买入区（语言切换时文字随 render(null) 重挂重建）
    if (usdtdSeries.length) {
      usdtdLine.setData(usdtdSeries);
        // v5 起标记改由 createSeriesMarkers 插件管理（setMarkers 已移除）。
        // 连续触及只给第一根带文字，避免相邻「买入」标签互相挤压
        const touches = usdtdSeries
          .filter((p) => p.value >= USDT_D_BUY_LEVEL)
          .map((p, i, arr) => {
            const firstOfCluster = i === 0 || p.time - arr[i - 1].time >= 30 * 144;
            return {
              time: p.time, position: 'belowBar', shape: 'arrowUp',
              color: COLORS.usdtdBuyText, text: firstOfCluster ? t('usdtdBuy') : '',
            };
          });
      if (!usdtdMarkersPlugin) usdtdMarkersPlugin = LWC.createSeriesMarkers(usdtdLine, touches);
      else usdtdMarkersPlugin.setMarkers(touches);
      if (usdtdZonePrim) usdtdLine.detachPrimitive(usdtdZonePrim);
      usdtdZonePrim = new UsdtBuyZone({
        buyLevel: USDT_D_BUY_LEVEL,
        strongLevel: USDT_D_STRONG_LEVEL,
        label: t('usdtdZoneLabel'),
        textColor: COLORS.usdtdBuyText,
        zoneColor: COLORS.usdtdZone,
      });
      if (usdtdOn) { usdtdLine.attachPrimitive(usdtdZonePrim); usdtdZoneAttached = true; }
      if (!usdtdPlBuy) {
        usdtdPlBuy = usdtdLine.createPriceLine({
          price: USDT_D_BUY_LEVEL, color: COLORS.usdtdLevel, lineWidth: 1,
          lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: '9%',
        });
        usdtdPlStrong = usdtdLine.createPriceLine({
          price: USDT_D_STRONG_LEVEL, color: COLORS.usdtdLevel, lineWidth: 1,
          lineStyle: LWC.LineStyle.Dotted, axisLabelVisible: true, title: '9.5%',
        });
      }
      usdtdNow = usdtdSeries.at(-1).value;
    }
    updateUsdtdTitle();
    waveNow = waveIndexAt(hNow);
    updateWaveTitle();
    // 标注挂载到当前可见的价格系列
    const host = styleHost();
    for (const p of attached) attachedHost.detachPrimitive(p);
    attachedHost = host;
    built = { bands: ann.bandPrims, halvings: ann.halvingPrims };
    attached = currentMainPrims();
    for (const p of attached) attachedHost.attachPrimitive(p);
    for (const p of attachedPhase) phaseSolid.detachPrimitive(p);
    builtPhase = { bands: ann.phaseBandPrims, halvings: ann.phaseHalvingPrims };
    attachedPhase = phaseOn ? currentPhasePrims() : [];
    for (const p of attachedPhase) phaseSolid.attachPrimitive(p);
    idxCache = null;
    if (fit) {
      // 等一帧，确保 autoSize 已应用真实容器尺寸
      requestAnimationFrame(() => {
        fitAll();
        renderBlockAxis();
        positionPhaseToggle(); // 面板尺寸就绪后校正副图按钮/标题位置
      });
    } else {
      renderBlockAxis();
      positionPhaseToggle();
    }
    updateStats();
    window.btc = { chart, series, phaseSolid, phaseDashed, pivots, candles: daily, bars, meta, usdtdSeries, usdtdLine }; // 调试用
  }

  // ── 顶栏统计 ──
  // 数值更新闪烁：对比上一次显示值，真正变化时底色亮起后淡出
  const lastShown = { price: NaN, height: NaN, wave: null };
  function flashValue(el, dir = null) {
    el.classList.remove('flash', 'flash-up', 'flash-down');
    void el.offsetWidth; // 强制重排以重启动画
    el.classList.add(dir === 'up' ? 'flash-up' : dir === 'down' ? 'flash-down' : 'flash');
  }

  function updateStats() {
    const last = dailyReal.at(-1);
    const prev = dailyReal.at(-2);
    if (!last) return;

    const priceNow = livePrice ?? last.close;
    updateLegendPrice();
    // 顶栏价格显示到美分：取整到美元会把逐笔成交的跳动全部抹平
    $('stat-price').textContent = `$${priceNow.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    if (Number.isFinite(lastShown.price) && priceNow !== lastShown.price) {
      flashValue($('stat-price').closest('.stat-value'), priceNow >= lastShown.price ? 'up' : 'down');
    }
    lastShown.price = priceNow;
    if (prev) {
      const chg = (priceNow - prev.close) / prev.close;
      const el = $('stat-chg');
      el.textContent = fmtPct(chg);
      el.className = `chg ${chg >= 0 ? 'up' : 'down'}`;
    }
    // 标签页标题即行情条（TradingView 式）：窄标签从右截断，优先级
    // 从左到右排——实时跳动的价格最高、慢变的 BWI 次之、站名殿后。
    // 只放两个裸数值：六万级的跳动数字自然读作 BTC 价格，0~1 的小数
    // 自然读作 BWI，标签与涨跌幅在窄标签里只会挤掉真正的信息
    //（随 250ms 节流刷新）
    if (waveNow !== null) {
      const priceTxt = priceNow.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      document.title = `${priceTxt} · ${waveNow.toFixed(3)} · ${t('brand')}`;
    }
    // 顶栏 BTC 周期指数读数（颜色 = 该值的 BTC 色）+ 变化闪烁
    const waveEl = $('stat-wave');
    const waveText = waveNow !== null ? waveNow.toFixed(3) : '—';
    waveEl.textContent = waveText;
    waveEl.style.color = waveNow !== null ? waveTextColor(waveNow) : '';
    if (lastShown.wave !== null && waveNow !== null && waveText !== lastShown.wave) {
      flashValue(waveEl.closest('.stat-value'));
    }
    if (waveNow !== null) lastShown.wave = waveText;
    // 色标游标跟随当前指数值
    const marker = $('ws-marker');
    if (waveNow !== null) {
      marker.hidden = false;
      marker.style.bottom = `calc(${(waveNow * 100).toFixed(2)}% - 5px)`; // 10px 圆钮取中
    }
    if (!meta) return;

    $('stat-height').textContent = fmtInt(meta.todayPos);
    if (Number.isFinite(lastShown.height) && Math.round(meta.todayPos) !== Math.round(lastShown.height)) {
      flashValue($('stat-height').closest('.stat-value'));
    }
    lastShown.height = meta.todayPos;
  }

  // ── 十字线 OHLC 读数（基于当前 bars） ──
  function prevRealClose(i) {
    for (let j = i - 1; j >= 0; j--) {
      if (bars[j].open !== undefined) return bars[j].close;
    }
    return null;
  }

  // ── 悬停信息卡：跟随光标，聚合该位置的全部读数 ──
  // 头部 = 区块高度 + ≈日期；行 = 色条 + 名称 + 右对齐数值
  //（开/高/低/收/涨跌幅 + BTC 指数 + 周期阶段）；
  // 悬停在未来推演区（无价格数据）时只显示区块/指数/阶段
  const tooltip = $('tooltip');
  let mouseX = 0;
  let mouseY = 0;
  // 捕获阶段监听：先于图表库内部处理更新坐标，十字线回调里拿到的
  // 一定是本次事件的位置；随移动同步重定位，避免一帧滞后
  $('chart').addEventListener('mousemove', (e) => {
    const r = $('chart').getBoundingClientRect();
    mouseX = e.clientX - r.left;
    mouseY = e.clientY - r.top;
    if (!tooltip.hidden) placeTooltip();
  }, { capture: true });
  $('chart').addEventListener('mouseleave', () => { tooltip.hidden = true; });

  // 贴着光标放置：默认右下方，越界时翻到另一侧
  function placeTooltip() {
    const host = $('chart');
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    let left = mouseX + 18;
    if (left + tw > host.clientWidth - 8) left = mouseX - 18 - tw;
    let top = mouseY + 18;
    if (top + th > host.clientHeight - 8) top = mouseY - 18 - th;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  function updateTooltip(param, bar) {
    if (param?.time === undefined) {
      tooltip.hidden = true;
      return;
    }
    const h = param.time;
    const row = (chip, label, val) =>
      `<div class="tt-row"><i class="tt-chip" style="background:${chip}"></i>`
      + `<span class="tt-label">${label}</span><span class="tt-val">${val}</span></div>`;
    let rows = '';
    if (bar) {
      const i = idxCache?.get(bar.time);
      const prevClose = i !== undefined ? prevRealClose(i) : null;
      const chg = prevClose ? (bar.close - prevClose) / prevClose : null;
      const dirColor = chg !== null && chg < 0 ? COLORS.down : COLORS.up;
      if (chartStyle === 'candles') {
        // K 线模式：一根蜡烛有四个价格，逐项展示
        const [o, hi, lo, cl] = t('legendOHLC');
        rows += row(dirColor, o, fmtPrice(bar.open));
        rows += row(dirColor, hi, fmtPrice(bar.high));
        rows += row(dirColor, lo, fmtPrice(bar.low));
        rows += row(dirColor, cl, fmtPrice(bar.close));
      } else {
        // 折线/BTC 着色：线本体取收盘价，只展示这一个价格
        rows += row(dirColor, t('ttPrice'), fmtPrice(bar.close));
      }
      if (chg !== null) rows += row(dirColor, t('ttChange'), fmtPct(chg));
    }
    const v = waveIndexAt(h);
    rows += row(waveTextColor(v), t('waveLabel'), v.toFixed(3));
    // USDT.D：与十字线同高的日频读数；进入买入区时追加提示行
    if (usdtdOn && usdtdSeries.length) {
      const uv = usdtdAtHeight(h);
      if (uv !== null) {
        rows += row(COLORS.usdtd, 'USDT.D', `${uv.toFixed(2)}%`);
        if (uv >= USDT_D_BUY_LEVEL) rows += row(COLORS.usdtdBuyText, `→ ${t('usdtdAlert')}`, '');
      }
    }
    // 周期阶段：BTC 上行段 = 牛市，下行段 = 熊市
    const s = (((h + WAVE_BULL_HALF) % HALVING_INTERVAL) + HALVING_INTERVAL) % HALVING_INTERVAL;
    const isBull = s < 2 * WAVE_BULL_HALF;
    rows += row(
      isBull ? COLORS.bullLabel : COLORS.bearLabel,
      t('ttPhase'),
      isBull ? t('bull') : t('bear'),
    );
    tooltip.innerHTML =
      `<div class="tt-head"><b>${t('ttBlock', fmtInt(h))}</b> ≈ ${fmtYMD(timeAtHeight(h))}</div>${rows}`;
    tooltip.hidden = false;
    placeTooltip();
  }

  chart.subscribeCrosshairMove((param) => {
    // 读数直接按时间键查 bars，不依赖价格系列（K线/折线切换均可用）
    let hovered = null;
    if (param?.time !== undefined) {
      if (!idxCache) idxCache = new Map(bars.map((x, i) => [x.time, i]));
      const b = bars[idxCache.get(param.time)];
      if (b && b.open !== undefined) hovered = b;
    }
    updateTooltip(param, hovered);
    updateLegendPrice(hovered ? hovered.close : null);
    // BTC 指数读数跟随十字线（未来虚线段也有值），移开时回落到当前值
    const w = param?.time !== undefined
      ? (param.seriesData.get(phaseSolid) ?? param.seriesData.get(phaseDashed))
      : null;
    updateWaveTitle(w ? w.value : waveNow);
    updateUsdtdTitle(param?.time !== undefined
      ? (usdtdAtHeight(param.time) ?? usdtdNow)
      : usdtdNow);
    // 底轴浮标：十字线位置的高度与≈日期
    updateAxisCursor(param?.time !== undefined ? param.time : null);
  });

  // 默认视图完整呈现全部价格历史：横向 [首根真实K线, 今日] 两侧各留
  // 3% 安全留白（未来推演区在右侧，滚轮缩小/右拖即可查看）；
  // 纵向由左轴自动缩放完成，scaleMargins 已留出上下安全边距
  function fitAll() {
    const first = bars.findIndex((b) => b.open !== undefined);
    if (first < 0 || !meta) return;
    const to = timeToLogical(meta.todayPos);
    const pad = (to - first) * 0.03;
    chart.timeScale().setVisibleLogicalRange({ from: first - pad, to: to + pad });
  }

  // ── 工具栏 ──
  const tfButtons = [...document.querySelectorAll('#tf-group button')];
  tfButtons.forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.tf === timeframe) return;
    timeframe = btn.dataset.tf;
    tfButtons.forEach((b) => b.classList.toggle('active', b === btn));
    localStorage.setItem(TF_KEY, timeframe);
    render(null);
    fitAll();
  }));

  // K线 / 折线 / BTC 着色切换：迁移标注宿主并保留缩放
  const styleButtons = [...document.querySelectorAll('#style-group button')];
  const scaleButtons = [...document.querySelectorAll('#scale-group button')];
  // HTML 里写死的是默认态；恢复持久化设置后同步按钮高亮
  tfButtons.forEach((b) => b.classList.toggle('active', b.dataset.tf === timeframe));
  styleButtons.forEach((b) => b.classList.toggle('active', b.dataset.style === chartStyle));
  scaleButtons.forEach((b) => b.classList.toggle('active', (b.dataset.scale === 'log') === logOn));
  $('halving-toggle').classList.toggle('active', halvingOn);
  $('bands-toggle').classList.toggle('active', bandsOn);
  styleButtons.forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.style === chartStyle) return;
    chartStyle = btn.dataset.style;
    styleButtons.forEach((b) => b.classList.toggle('active', b === btn));
    localStorage.setItem(STYLE_KEY, chartStyle);
    series.applyOptions({ visible: chartStyle === 'candles' });
    lineSeries.applyOptions({ visible: chartStyle === 'line' });
    waveLine.applyOptions({ visible: chartStyle === 'wave' });
    render(null); // 标注重新挂载到当前可见的价格系列
  }));

  // ── 语言：刷新所有静态文案（图内标注由 render 重建时套用） ──
  const TF_KEYS = { day: 'tfDay', week: 'tfWeek', month: 'tfMonth' };
  const STYLE_KEYS = { candles: 'styleCandles', line: 'styleLine', wave: 'styleWave' };
  function applyStaticLang() {
    document.documentElement.lang = I18N.lang === 'zh' ? 'zh-CN' : 'en';
    $('brand-name').textContent = t('brand');
    const sub = t('brandSub');
    $('brand-sub').textContent = sub;
    $('brand-sub').hidden = !sub;
    $('loading-brand').textContent = t('brand');
    $('label-height').textContent = t('axisName');
    $('stat-wave-label').textContent = t('statWave'); // 中文全称 / 英文缩写 BWI
    $('stat-wave-cell').title = t('titleWaveStat');
    tfButtons.forEach((b) => { b.textContent = t(TF_KEYS[b.dataset.tf]); });
    styleButtons.forEach((b) => { b.textContent = t(STYLE_KEYS[b.dataset.style]); });
    $('label-price').textContent = t('priceLabel');
    $('bx-name').textContent = t('axisName');
    // tooltip / aria 文案同样随语言刷新（否则切 EN 后悬停仍弹中文）
    $('lang-toggle').title = t('titleLang');
    $('theme-toggle').title = t('titleTheme');
    $('tf-group').title = t('titleTf');
    $('style-group').title = t('titleStyle');
    $('scale-group').title = t('titleScale');
    $('halving-toggle').title = t('titleAnnotHalving');
    $('bands-toggle').title = t('titleAnnotBands');
    $('phase-toggle').title = t('titlePhase');
    $('usdtd-toggle').title = t('titleUsdtd');
    $('wave-scale').title = t('titleWaveScale');
    $('notice-close').setAttribute('aria-label', t('closeLabel'));
    $('about-toggle').title = t('titleAbout');
    $('about-title').textContent = t('aboutTitle');
    $('about-body').innerHTML = t('aboutHtml');
    $('about-close').setAttribute('aria-label', t('closeLabel'));
    scaleButtons.forEach((b) => { b.textContent = t(b.dataset.scale === 'log' ? 'log' : 'linear'); });
    $('ws-top').textContent = t('scaleTop');
    $('ws-bottom').textContent = t('scaleBottom');
  }
  applyStaticLang();

  // ── 指标说明弹窗：按钮打开；点遮罩 / 关闭按钮 / Esc 关闭 ──
  // 离场沿到场路径反向播放（.closing 动画），播完才真正 hidden；
  // 退场途中再次打开会打断退场、立即回到打开态（动画可打断）
  const aboutOverlay = $('about-overlay');
  function openAbout() {
    aboutOverlay.classList.remove('closing');
    aboutOverlay.hidden = false;
  }
  function closeAbout() {
    if (aboutOverlay.hidden || aboutOverlay.classList.contains('closing')) return;
    aboutOverlay.classList.add('closing');
    const done = () => {
      if (aboutOverlay.classList.contains('closing')) {
        aboutOverlay.hidden = true;
        aboutOverlay.classList.remove('closing');
      }
    };
    aboutOverlay.addEventListener('animationend', done, { once: true });
    setTimeout(done, 300); // 动画事件缺失时的兜底
  }
  $('about-toggle').addEventListener('click', openAbout);
  $('about-close').addEventListener('click', closeAbout);
  aboutOverlay.addEventListener('click', (e) => {
    if (e.target === aboutOverlay) closeAbout();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !aboutOverlay.hidden) closeAbout();
  });

  $('lang-toggle').addEventListener('click', () => {
    setLang(I18N.lang === 'zh' ? 'en' : 'zh');
    localStorage.setItem(LANG_KEY, I18N.lang);
    applyStaticLang(); // 会同步 html.lang，按钮字形随之切换
    makeWatermark();
    render(null); // 重建标注/标签轴/读数以套用新语言（保留当前缩放）
  });

  scaleButtons.forEach((btn) => btn.addEventListener('click', () => {
    const useLog = btn.dataset.scale === 'log';
    if (useLog === logOn) return;
    logOn = useLog;
    setLogScale(chart, logOn);
    scaleButtons.forEach((b) => b.classList.toggle('active', b === btn));
    localStorage.setItem(SCALE_KEY, logOn ? 'log' : 'linear');
  }));

  // 两个标注开关共用一套「全卸再按开关重挂」流程
  function applyAnnotations() {
    for (const p of attached) attachedHost.detachPrimitive(p);
    attached = currentMainPrims();
    for (const p of attached) attachedHost.attachPrimitive(p);
    for (const p of attachedPhase) phaseSolid.detachPrimitive(p);
    attachedPhase = phaseOn ? currentPhasePrims() : [];
    for (const p of attachedPhase) phaseSolid.attachPrimitive(p);
  }

  $('halving-toggle').addEventListener('click', () => {
    halvingOn = !halvingOn;
    applyAnnotations();
    $('halving-toggle').classList.toggle('active', halvingOn);
    localStorage.setItem(ANNOT_HALVING_KEY, halvingOn ? '1' : '0');
  });

  $('bands-toggle').addEventListener('click', () => {
    bandsOn = !bandsOn;
    applyAnnotations();
    $('bands-toggle').classList.toggle('active', bandsOn);
    localStorage.setItem(ANNOT_BANDS_KEY, bandsOn ? '1' : '0');
  });

  $('theme-toggle').addEventListener('click', () => {
    themeName = themeName === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, themeName);
    setTheme(themeName);
    document.documentElement.dataset.theme = themeName;
    applyChartTheme(chart, series, lineSeries, phaseSolid, phaseDashed, usdtdLine);
    makeWatermark();
    render(null); // 重建标注/标签轴以套用新配色（保留当前缩放）
  });

  // ── 数据：快照与高度锚点立即渲染，实时尾部与链上高度后台升级 ──
  // USDT.D 快照并行拉取（独立资源，失败只留空窗格，不阻塞主图）
  const usdtSnap = fetch('data/usdt-dominance.json')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((json) => json.series || [])
    .catch((e) => { console.warn('USDT.D 数据加载失败（窗格留空）：', e); return []; });
  let snapshot;
  try {
    // 跳位解构：第二项是锚点加载（无返回值），第三项才是 USDT.D 原始序列
    [snapshot, , usdtRaw] = await Promise.all([loadSnapshot(), loadHeightAnchors(), usdtSnap]);
  } catch (e) {
    console.error(e);
    $('loading-text').textContent = t('loadFailData', e.message);
    return;
  }
  render(snapshot, { fit: true });
  makeWatermark();
  $('loading').hidden = true;

  const sinceTs = snapshot.at(-1).time;
  const [liveRes, tipRes] = await Promise.allSettled([
    (async () => {
      try {
        return await fetchBitstampLive(sinceTs);
      } catch (e1) {
        console.warn('Bitstamp 实时数据失败，尝试 Coinbase：', e1);
        return fetchCoinbaseFallback(sinceTs);
      }
    })(),
    fetchTipAnchor(),
  ]);

  if (tipRes.status === 'fulfilled') {
    tipHeight = tipRes.value;
  } else {
    console.warn('链上高度获取失败，按锚点外推：', tipRes.reason);
  }

  if (liveRes.status === 'fulfilled' && liveRes.value.length) {
    render(mergeCandles(snapshot, liveRes.value));
  } else {
    if (liveRes.status === 'rejected') console.warn('Coinbase 备用源也失败：', liveRes.reason);
    render(null); // 至少套用 tipHeight
    showNotice(t('noticeStale', fmtYMD(sinceTs)));
  }

  // ── 实时数据流 ──
  // 价格走 Bitstamp WebSocket 逐笔成交（肉眼可见的连续跳动）：
  // 顶栏读数逐笔即时更新；图表重绘节流到最多 2s 一次（每笔成交都
  // 全量重绘太重）。WS 断线 5s 后自动重连，期间 30s ticker 轮询兜底。
  // 链上高度 60s 轮询（新区块 ≈ 每 10 分钟）：高度前移走完整 render；
  // K 线尾部 5 分钟重取一次（跨 UTC 零点时长出新的一根日线）
  let chartRenderQueued = false;
  let statsFlushTimer = null;
  function applyLivePrice(p) {
    if (!Number.isFinite(p) || p === livePrice) return;
    livePrice = p;
    const lastC = dailyReal.at(-1);
    if (lastC) {
      // daily 与 dailyReal 共享对象引用，改这里即改数据源
      lastC.close = p;
      if (p > lastC.high) lastC.high = p;
      if (p < lastC.low) lastC.low = p;
    }
    // 顶栏刷新 250ms 合并：盘口流一秒可达多条，逐条刷 DOM 没有意义
    if (!statsFlushTimer) {
      statsFlushTimer = setTimeout(() => {
        statsFlushTimer = null;
        updateStats();
      }, 250);
    }
    if (lastC && !chartRenderQueued) {
      chartRenderQueued = true;
      setTimeout(() => {
        chartRenderQueued = false;
        render(null); // 视图不动，K 线尾部/价格牌/引导线原地刷新
      }, 2000);
    }
  }

  let wsAlive = false;
  function connectPriceStream() {
    let sock;
    try {
      sock = new WebSocket('wss://ws.bitstamp.net');
    } catch {
      return; // 环境不支持时永久走轮询兜底
    }
    sock.onopen = () => {
      wsAlive = true;
      // 逐笔成交 = 真实成交价；盘口 = 买一/卖一每秒多次变动，
      // 用中间价填充成交之间的空隙，价格秒级连续跳动
      sock.send(JSON.stringify({ event: 'bts:subscribe', data: { channel: 'live_trades_btcusd' } }));
      sock.send(JSON.stringify({ event: 'bts:subscribe', data: { channel: 'order_book_btcusd' } }));
    };
    sock.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.event === 'trade' && msg.data?.price) {
          applyLivePrice(Number(msg.data.price));
        } else if (msg.event === 'data' && msg.channel === 'order_book_btcusd') {
          const bid = Number(msg.data?.bids?.[0]?.[0]);
          const ask = Number(msg.data?.asks?.[0]?.[0]);
          if (Number.isFinite(bid) && Number.isFinite(ask)) {
            applyLivePrice((bid + ask) / 2);
          }
        }
      } catch { /* 忽略坏消息 */ }
    };
    sock.onclose = () => {
      wsAlive = false;
      setTimeout(connectPriceStream, 5000);
    };
    sock.onerror = () => {
      try { sock.close(); } catch { /* 已关闭 */ }
    };
  }

  async function pollPrice() {
    if (wsAlive) return; // WS 在线时无需轮询
    try {
      const res = await fetch('https://www.bitstamp.net/api/v2/ticker/btcusd/', {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return;
      applyLivePrice(parseFloat((await res.json()).last));
    } catch { /* 单次失败静默，下一轮再试 */ }
  }
  async function pollHeight() {
    try {
      const tip = await fetchTipAnchor();
      if (Number.isFinite(tip) && tip !== tipHeight) {
        tipHeight = tip;
        render(null);
      }
    } catch { /* 单次失败静默，下一轮再试 */ }
  }
  let candleRefreshBusy = false;
  async function pollCandles() {
    if (candleRefreshBusy || !dailyReal.length) return;
    candleRefreshBusy = true;
    try {
      const tail = await fetchBitstampLive(dailyReal.at(-1).time - DAY);
      if (tail.length) render(mergeCandles(daily, tail));
    } catch { /* 单次失败静默，下一轮再试 */ } finally {
      candleRefreshBusy = false;
    }
  }
  setInterval(pollPrice, 30000);
  setInterval(pollHeight, 60000);
  setInterval(pollCandles, 300000);
  pollPrice();
  connectPriceStream();
  console.table(pivots.map((p) => ({ 类型: p.type === 'top' ? '牛顶' : '熊底', 日期: fmtDate(p.time), 价格: p.price, 高度: heightAt(p.time) })));
}

init().catch((e) => {
  console.error(e);
  $('loading-text').textContent = t('loadFailInit', e.message);
});
