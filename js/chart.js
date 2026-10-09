// 图表创建与主题（对数坐标、中文、全范围可缩放、BTC 指数副图区）。
// 横轴以区块高度为主：内置时间轴隐藏，底部刻度（高度 + ≈日期）由
// main.js 的自绘轴条负责。
import { COLORS, FONT_MONO } from './config.js';

const priceFormatter = (p) => (p >= 100
  ? Math.round(p).toLocaleString('en-US')
  : p.toFixed(2));

function themeOptions() {
  return {
    layout: {
      background: { type: 'solid', color: COLORS.chartBg },
      textColor: COLORS.chartText,
      fontFamily: FONT_MONO, // 轴上只有数字：数据终端语言要求数字一律等宽
      fontSize: 11,
      attributionLogo: false, // 库署名已在 README/页脚层面保留
      panes: {
        separatorColor: COLORS.scaleBorder,
        separatorHoverColor: COLORS.paneSepHover, // hover 高亮暗示分隔条可拖拽
        enableResize: true,
      },
    },
    grid: {
      // 不画网格：纵向与减半日/今日竖线视觉冲突，横向（价格刻度线）按
      // 用户要求移除——价格定位交给十字线与现价引导线
      vertLines: { visible: false },
      horzLines: { visible: false },
    },
    crosshair: {
      vertLine: { color: COLORS.crosshairLine, labelBackgroundColor: COLORS.crosshairLabelBg },
      horzLine: { color: COLORS.crosshairLine, labelBackgroundColor: COLORS.crosshairLabelBg },
    },
    leftPriceScale: { borderColor: COLORS.scaleBorder },
  };
}

function seriesThemeOptions() {
  return {
    upColor: COLORS.up,
    downColor: COLORS.down,
    wickUpColor: COLORS.up,
    wickDownColor: COLORS.down,
    borderVisible: false,
    // 价格格式挂在系列上而非 localization.priceFormatter：
    // 后者是全图表生效，会把副图区 0~1 的指数读数也格式化成价格
    priceFormat: { type: 'custom', formatter: priceFormatter, minMove: 0.01 },
  };
}

function phaseThemeOptions() {
  return { color: COLORS.phase };
}

function lineThemeOptions() {
  return { color: COLORS.line }; // 中性线色：整条线用「涨」的绿会违背色彩语义
}

export function createChartAndSeries(container) {
  const LWC = window.LightweightCharts;

  const chart = LWC.createChart(container, {
    autoSize: true,
    ...themeOptions(),
    // 价格轴在左侧；右缘不留轴
    rightPriceScale: { visible: false },
    leftPriceScale: {
      visible: true,
      mode: LWC.PriceScaleMode.Logarithmic,
      borderColor: COLORS.scaleBorder,
      scaleMargins: { top: 0.06, bottom: 0.04 },
      tickMarkDensity: 4, // 刻度间距 = 字号 × 系数；默认 2.5 太密
    },
    timeScale: {
      visible: false, // 底部刻度轴由自绘的区块轴条接管
      // 默认 minBarSpacing 0.5 会让 ~5300 根 K 线无法一屏放下，必须调小
      minBarSpacing: 0.05,
    },
    localization: { locale: 'zh-CN' },
  });

  const series = chart.addSeries(LWC.CandlestickSeries, {
    ...seriesThemeOptions(),
    priceScaleId: 'left',
  });

  // 折线模式的价格系列（收盘价），与 K 线切换显示、共用左轴
  const lineSeries = chart.addSeries(LWC.LineSeries, {
    ...lineThemeOptions(),
    priceScaleId: 'left',
    lineWidth: 1.5,
    visible: false,
    priceFormat: { type: 'custom', formatter: priceFormatter, minMove: 0.01 },
    priceLineVisible: true,
    lastValueVisible: true,
  });

  // BTC 着色模式：折线逐点着色（颜色 = 该处 BTC 指数，蓝 0 → 红 1），
  // 颜色随数据点传入，不走主题
  const waveLine = chart.addSeries(LWC.LineSeries, {
    priceScaleId: 'left',
    lineWidth: 2.5,
    visible: false,
    priceFormat: { type: 'custom', formatter: priceFormatter, minMove: 0.01 },
    priceLineVisible: true,
    lastValueVisible: true,
  });

  // BTC 周期指数副图区（TradingView 风格的下方独立面板）：
  // 实线 = 已发生，虚线 = 预测段；左轴显示 0~1 小数读数
  // 三位小数：指数按区块推进（144 区块桶 ≈ 0.001），两位小数几天不动
  const phaseFormat = { type: 'custom', formatter: (v) => v.toFixed(3), minMove: 0.001 };
  const phaseSolid = chart.addSeries(LWC.LineSeries, {
    ...phaseThemeOptions(),
    priceScaleId: 'left',
    lineWidth: 1.5,
    priceFormat: phaseFormat,
    priceLineVisible: true, // 当前指数的水平虚线，与主图价格引导线同款
    lastValueVisible: true,
  }, 1);
  const phaseDashed = chart.addSeries(LWC.LineSeries, {
    ...phaseThemeOptions(),
    priceScaleId: 'left',
    lineWidth: 1.5,
    lineStyle: LWC.LineStyle.Dashed,
    priceFormat: phaseFormat,
    priceLineVisible: false,
    lastValueVisible: false,
  }, 1);
  // 副图的价格轴必须显式设为线性：chart 级 rightPriceScale 的对数模式
  // 会套到所有面板，0 值在对数轴上会导致折线被削顶
  // 指数恒在 0~1，上下只留极少留白，避免浪费副图空间
  phaseSolid.priceScale().applyOptions({
    mode: LWC.PriceScaleMode.Normal,
    scaleMargins: { top: 0.06, bottom: 0.05 },
  });

  // 主图 : BWI 副图 ≈ 4 : 1
  try {
    const panes = chart.panes();
    panes[0].setStretchFactor(4);
    panes[1].setStretchFactor(1);
  } catch (e) {
    console.warn('副图高度设置失败（不影响功能）：', e);
  }

  // USDT.D 副图区（第三面板）：USDT 市值占全加密市场百分比（%）。
  // 折线 = 日频重建序列；9% / 9.5% 两条买入阈值线由 main.js 挂载。
  // 独立于 BTC 指数：一个是「周期位置」（0~1），一个是「资金避险温度」
  //（2~10%），量纲不同必须分面板，不可共轴
  const usdtdFormat = { type: 'custom', formatter: (v) => v.toFixed(2) + '%', minMove: 0.01 };
  const usdtdLine = chart.addSeries(LWC.LineSeries, {
    color: COLORS.usdtd,
    priceScaleId: 'left',
    lineWidth: 1.5,
    priceFormat: usdtdFormat,
    priceLineVisible: true,
    lastValueVisible: true,
    pointMarkersVisible: false,
    visible: false, // 默认隐藏，main.js 加载数据后按持久化状态显示
  }, 2);
  usdtdLine.priceScale().applyOptions({
    mode: LWC.PriceScaleMode.Normal,
    scaleMargins: { top: 0.08, bottom: 0.06 },
  });

  try {
    const panes = chart.panes();
    panes[0].setStretchFactor(4);
    panes[1].setStretchFactor(1);
    panes[2].setStretchFactor(1);
  } catch (e) {
    console.warn('第三面板高度设置失败（不影响功能）：', e);
  }

  return { chart, series, lineSeries, waveLine, phaseSolid, phaseDashed, usdtdLine };
}

// 主题切换时刷新图表配色（标注由调用方重建）
export function applyChartTheme(chart, series, lineSeries, phaseSolid, phaseDashed, usdtdLine) {
  chart.applyOptions(themeOptions());
  series.applyOptions(seriesThemeOptions());
  lineSeries.applyOptions(lineThemeOptions());
  phaseSolid.applyOptions(phaseThemeOptions());
  phaseDashed.applyOptions(phaseThemeOptions());
  if (usdtdLine) usdtdLine.applyOptions({ color: COLORS.usdtd });
}

// 对数/线性切换
export function setLogScale(chart, useLog) {
  const LWC = window.LightweightCharts;
  chart.priceScale('left').applyOptions({
    mode: useLog ? LWC.PriceScaleMode.Logarithmic : LWC.PriceScaleMode.Normal,
  });
}
