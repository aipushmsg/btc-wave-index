// 轻量中英文字典。t(key, ...args) 取当前语言文案，函数型条目用于带参数拼接。
export const STRINGS = {
  zh: {
    brand: 'BTC 周期指数',
    brandSub: 'BTC WAVE INDEX',
    tfDay: '日',
    tfWeek: '周',
    tfMonth: '月',
    styleCandles: 'K线',
    styleLine: '折线',
    styleWave: 'BTC 着色',
    log: '对数',
    linear: '线性',
    priceLabel: '比特币价格',
    waveLabel: 'BTC 指数',
    scaleTop: '牛顶',
    scaleBottom: '熊底',
    halvingTag: (n, d) => `第 ${n} 次减半（${d}）`,
    windowDays: (d) => `${d} 天`,
    bull: '牛市',
    bear: '熊市',
    paneTitleName: 'BTC 周期指数',
    statWave: 'BTC 周期指数',
    watermark: ['BTC 周期指数', '作者：柠檬狗 · @0xLemonDog'],
    axisName: '区块高度',
    legendOHLC: ['开', '高', '低', '收'],
    ttBlock: (n) => `区块 ${n}`,
    ttPrice: '价格',
    ttChange: '涨跌幅',
    ttPhase: '周期阶段',
    titleLang: '语言',
    titleTheme: '深/浅主题',
    titleWaveStat: '0 = 熊底 · 1 = 牛顶',
    titleTf: '分桶粒度：日 = 144 区块 · 周 = 1,008 · 月 = 4,368',
    titleStyle: '图表类型',
    titleScale: '价格坐标',
    titleAnnotHalving: '显示/隐藏减半日标注',
    titleAnnotBands: '显示/隐藏牛/熊市标注',
    titlePhase: '显示/隐藏 BTC 指数窗格',
    titleUsdtd: '显示/隐藏 USDT.D 窗格',
    usdtdZoneBuyLabel: '开始买入大饼',
    usdtdZoneSellLabel: '开始卖出大饼',
    usdtdBuy: '买入',
    usdtdSell: '卖出',
    usdtdAlertBuy: '开始买入大饼时间',
    usdtdAlertSell: '开始卖出大饼时间',
    titleWaveScale: 'BTC 指数色标',
    titleAbout: '指标说明',
    aboutTitle: 'BTC 周期指数 · 指标说明',
    aboutHtml: `
<section>
  <h3>概览</h3>
  <p>BTC 周期指数（BTC Wave Index，BWI）是一个纯区块制的比特币周期位置指标：不使用价格、成交量或任何链上活动数据，唯一输入是<b>区块高度</b>。指数在 <code>0</code> 与 <code>1</code> 之间往复运行——<code>0</code> = 理论熊市底部，<code>1</code> = 理论牛市顶部。</p>
</section>
<section>
  <h3>模型</h3>
  <p>指数由三条结构性假设唯一确定：</p>
  <ul>
    <li><b>周期锚定减半</b>：每 <code>210,000</code> 个区块（≈ 4 年）发生一次减半，一个减半间隔即一个完整周期。</li>
    <li><b>牛三熊一</b>：每个周期中牛市占 <code>157,500</code> 块（3/4），熊市占 <code>52,500</code> 块（1/4）。</li>
    <li><b>减半居牛市正中</b>：牛市区间 = 减半高度 ± <code>78,750</code> 块，其余为熊市。</li>
  </ul>
</section>
<section>
  <h3>计算公式</h3>
  <p>对任意区块高度 <code>h</code>，先求其在周期内的相位 <code>s</code>：</p>
  <div class="about-formula">s = (h + 78,750) mod 210,000

BWI(h) = s / 157,500　　　　　　　　　　 s &lt; 157,500（牛市段）
BWI(h) = 1 − (s − 157,500) / 52,500　　s ≥ 157,500（熊市段）</div>
  <p>牛市段以恒定速率每块 <code>+1/157,500</code> 从 0 升至 1，熊市段以每块 <code>−1/52,500</code> 从 1 降回 0；减半时刻恰为 <code>BWI = 0.5</code>。</p>
</section>
<section>
  <h3>解读</h3>
  <ul>
    <li>上行段 = 模型牛市，下行段 = 模型熊市。读数须结合方向：同一数值每个周期出现两次（升、降各一次）。</li>
    <li>数值即周期进度：牛市段中 BWI 为牛市已完成比例，熊市段中 <code>1 − BWI</code> 为熊市已完成比例。</li>
    <li>区块高度完全可预测（平均每 10 分钟一块），指数的未来路径可以精确推演——图中虚线段即未来推演。</li>
    <li>全站将指数值映射到蓝（0）→ 红（1）色谱：BTC 着色模式与右侧色标同一映射。</li>
  </ul>
</section>
<section>
  <h3>特性与局限</h3>
  <ul>
    <li><b>完全确定</b>：BWI 是区块高度的纯函数，无任何可调参数，任何人可独立复算。</li>
    <li><b>无价格反馈</b>：指数刻画周期时点而非估值水平，不会因行情涨跌而移动。</li>
    <li><b>假设依赖</b>：有效性取决于「四年减半周期 + 牛三熊一结构」持续成立；市场结构性改变将削弱其现实解释力。</li>
  </ul>
</section>`,
    closeLabel: '关闭',
    loading: '加载行情数据中…',
    loadFailData: (msg) => `历史数据加载失败：${msg}`,
    loadFailInit: (msg) => `页面初始化失败：${msg}`,
    noticeStale: (d) => `实时数据加载失败，当前显示截至 ${d} 的历史数据。`,
  },
  en: {
    brand: 'BTC Wave Index',
    brandSub: '', // 英文界面主名即英文，副标题隐藏
    tfDay: 'D',
    tfWeek: 'W',
    tfMonth: 'M',
    styleCandles: 'Candles',
    styleLine: 'Line',
    styleWave: 'Wave',
    log: 'Log',
    linear: 'Linear',
    priceLabel: 'BTC Price',
    waveLabel: 'Wave Index',
    scaleTop: 'Top',
    scaleBottom: 'Bottom',
    halvingTag: (n, d) => `Halving #${n} (${d})`,
    windowDays: (d) => `${d} days`,
    bull: 'Bull',
    bear: 'Bear',
    paneTitleName: 'BTC Wave Index',
    statWave: 'BWI',
    watermark: ['BTC Wave Index', 'Creator: LemonDog · @0xLemonDog'],
    axisName: 'Block Height',
    legendOHLC: ['O', 'H', 'L', 'C'],
    ttBlock: (n) => `Block ${n}`,
    ttPrice: 'Price',
    ttChange: 'Change',
    ttPhase: 'Phase',
    titleLang: 'Language',
    titleTheme: 'Dark / light theme',
    titleWaveStat: 'BTC Wave Index · 0 = bear bottom · 1 = bull top',
    titleTf: 'Bucket size: D = 144 blocks · W = 1,008 · M = 4,368',
    titleStyle: 'Chart type',
    titleScale: 'Price scale',
    titleAnnotHalving: 'Show/hide halving marks',
    titleAnnotBands: 'Show/hide bull/bear marks',
    titlePhase: 'Show/hide Wave Index pane',
    titleUsdtd: 'Show/hide USDT.D pane',
    usdtdZoneBuyLabel: 'BUY BTC ZONE',
    usdtdZoneSellLabel: 'SELL BTC ZONE',
    usdtdBuy: 'BUY',
    usdtdSell: 'SELL',
    usdtdAlertBuy: 'Time to buy BTC',
    usdtdAlertSell: 'Time to sell BTC',
    titleWaveScale: 'Wave Index color scale',
    titleAbout: 'Methodology',
    aboutTitle: 'BTC Wave Index · Methodology',
    aboutHtml: `
<section>
  <h3>Overview</h3>
  <p>The BTC Wave Index (BWI) is a block-native Bitcoin cycle-position indicator. It uses no price, volume, or on-chain activity data — its only input is <b>block height</b>. The index oscillates between <code>0</code> and <code>1</code>: <code>0</code> = theoretical bear-market bottom, <code>1</code> = theoretical bull-market top.</p>
</section>
<section>
  <h3>Model</h3>
  <p>The index is fully determined by three structural assumptions:</p>
  <ul>
    <li><b>Cycles anchor to halvings</b>: one halving every <code>210,000</code> blocks (≈ 4 years); one halving interval is one full cycle.</li>
    <li><b>3 : 1 bull-to-bear split</b>: each cycle spends <code>157,500</code> blocks (3/4) in the bull phase and <code>52,500</code> blocks (1/4) in the bear phase.</li>
    <li><b>The halving sits at the bull midpoint</b>: bull phase = halving height ± <code>78,750</code> blocks; the remainder is the bear phase.</li>
  </ul>
</section>
<section>
  <h3>Calculation</h3>
  <p>For any block height <code>h</code>, take its phase <code>s</code> within the cycle:</p>
  <div class="about-formula">s = (h + 78,750) mod 210,000

BWI(h) = s / 157,500                  s &lt; 157,500  (bull)
BWI(h) = 1 − (s − 157,500) / 52,500   s ≥ 157,500  (bear)</div>
  <p>The index climbs 0 → 1 at a constant <code>+1/157,500</code> per block in the bull phase and falls 1 → 0 at <code>−1/52,500</code> per block in the bear phase; at every halving, <code>BWI = 0.5</code> exactly.</p>
</section>
<section>
  <h3>Interpretation</h3>
  <ul>
    <li>Rising segment = model bull market, falling segment = model bear market. Read the value together with its direction: every value occurs twice per cycle (once rising, once falling).</li>
    <li>The value is cycle progress: in the bull phase BWI is the fraction of the bull completed; in the bear phase <code>1 − BWI</code> is the fraction of the bear completed.</li>
    <li>Block height is fully predictable (≈ one block per 10 minutes), so the index's future path can be projected exactly — the dashed segment on the chart.</li>
    <li>Site-wide, values map onto a blue (0) → red (1) spectrum: Wave Color mode and the right-hand color scale share this mapping.</li>
  </ul>
</section>
<section>
  <h3>Properties &amp; Limitations</h3>
  <ul>
    <li><b>Fully deterministic</b>: BWI is a pure function of block height with no tunable parameters — anyone can recompute it independently.</li>
    <li><b>No price feedback</b>: it marks cycle position, not valuation, and never moves in response to price.</li>
    <li><b>Assumption-dependent</b>: its validity rests on the 4-year halving cycle and the 3 : 1 structure continuing to hold; a structural market change would weaken its explanatory power.</li>
  </ul>
</section>`,
    closeLabel: 'Close',
    loading: 'Loading market data…',
    loadFailData: (msg) => `Failed to load historical data: ${msg}`,
    loadFailInit: (msg) => `Initialization failed: ${msg}`,
    noticeStale: (d) => `Live data unavailable — showing history up to ${d}.`,
  },
};

export const I18N = { lang: 'en' }; // 默认英文界面

export function setLang(lang) {
  I18N.lang = STRINGS[lang] ? lang : 'zh';
}

export function t(key, ...args) {
  const v = STRINGS[I18N.lang][key] ?? STRINGS.zh[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}
