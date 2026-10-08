// 减半买卖窗口直角标注（经典比特币周期图语言）：
//   绿直角 = 减半前 500 天买入——竖边锚在买入日真实收盘价，横边向右
//            延伸 500 天到减半线，横边即「持有窗口」的时间跨度；
//   红直角 = 减半后 500 天卖出——横边从减半线向右延伸 500 天，竖边
//            向下接到卖出日真实收盘价。
// 直角只有两个锚点跟随坐标系（时间 → x、价格 → y），两条边的长度按
// 面板高度取固定比例（钳制在舒适区间），缩放时形状稳定、不随价格轴
// 拉伸变形；横边贴到面板顶/底时钳回面板内，竖边随之自然缩短。
// 锚价在数据边界之外（更早历史 / 尚未走到的未来窗口）时降级为推演
// 直角（projected）：窗口时间由区块高度精确确定，价位未定——虚线
//（与 BTC 指数「实线已发生、虚线推演」同一语言），横边固定在面板上/
// 下部的窗口带内，竖边朝价格方向伸出固定长度、悬空端不接任何数据点。
import { Primitive } from './base.js';
import { FONT } from '../config.js';

const LINE_W = 2;    // 直角边宽（比减半竖线醒目，与截图的笔触一致）
const LABEL_GAP = 8; // 「500 days」与横边的间距
// 推演直角的虚线笔触：短划与 BTC 指数未来段同风格，间隙略窄（短边不散）
const DASH = [5, 4];
// 横边贴面板边缘的钳制边距。顶部 12px 够用（文字统一画在横边下方，
// 红横边贴顶时文字仍落在面板内）；底部要给文字（~11px）与面板最底的
// 牛/熊类型胶囊行（高约 20px、贴底 8px）留出整行空间，64px 一次让够
const EDGE_PAD_TOP = 12;
const EDGE_PAD_BOTTOM = 64;

export class HalvingTrade extends Primitive {
  constructor({ mode, halvingH, anchorH, price = null, label, color, projected = false }) {
    // 'normal' 层：画在数据之上，竖边穿过价格曲线仍完整可见（同截图）
    super('normal');
    this._mode = mode;       // 'buy'（锚点在左、横边向右）| 'sell'（锚点在右、横边向左）
    this._halvingH = halvingH;
    this._anchorH = anchorH; // 买入/卖出日高度
    this._price = price;     // 买入/卖出日收盘价（推演直角不使用）
    this._label = label;
    this._color = color;
    this._projected = projected; // true = 虚线推演：窗口时间确定、价位未定
  }

  _draw(ctx, media) {
    const xA = this.timeToX(this._anchorH);
    const xH = this.timeToX(this._halvingH);
    if (xA === null || xH === null) return;
    // 完全滚出左右视口就不画，部分可见交给画布裁剪
    const xL = Math.min(xA, xH);
    const xR = Math.max(xA, xH);
    if (xR < 0 || xL > media.width) return;

    // 直角边长：随面板高度等比、钳制在舒适区间（窄面板不至于短到看不见）
    const leg = Math.max(56, Math.min(120, media.height * 0.16));
    let yP = null;
    let yLine;
    if (this._projected) {
      // 推演窗口：横边贴面板顶/底（与实线直角贴边钳制的位置一致，
      // 且恰好躲开减半线竖排标签与底部胶囊行），竖边朝面板内伸出
      // 固定长度，悬空端示意「价位未定」
      yLine = this._mode === 'buy'
        ? media.height - EDGE_PAD_BOTTOM
        : EDGE_PAD_TOP;
    } else {
      yP = this.priceToY(this._price);
      if (yP === null || !Number.isFinite(yP) || yP < -100 || yP > media.height + 100) return;
      // 锚价滚出面板上下边界太远时不再落笔（放大到局部时直角随之隐去）
      // 买入：横边在锚价下方（钳在胶囊行之上）；卖出：横边在锚价上方
      //（贴顶钳回面板内，竖边随之自然缩短）
      yLine = this._mode === 'buy'
        ? Math.min(yP + leg, media.height - EDGE_PAD_BOTTOM)
        : Math.max(yP - leg, EDGE_PAD_TOP);
    }

    ctx.strokeStyle = this._color;
    ctx.lineWidth = LINE_W;
    ctx.setLineDash(this._projected ? DASH : []);
    ctx.beginPath();
    if (this._mode === 'buy') {
      // 竖边：买入价（实线）或悬空端（推演）→ 横边
      ctx.moveTo(xA, yP ?? yLine - leg);
      ctx.lineTo(xA, yLine);
      ctx.lineTo(xH, yLine); // 横边：向右 500 天，端点落在减半线上
    } else {
      ctx.moveTo(xH, yLine); // 横边：从减半线向右 500 天
      ctx.lineTo(xA, yLine);
      ctx.lineTo(xA, yP ?? yLine + leg); // 竖边：横边 → 卖出价 / 悬空端
    }
    ctx.stroke();
    ctx.setLineDash([]); // 画布状态跨图元共享，虚线笔触必须当场恢复

    // 「500 days」：统一放在横边下方。红横边贴近面板顶时上方没有文字
    // 空间；下方是横边与价格曲线之间的空档——卖出窗口内曲线最高点即
    // 锚价附近，横边恒在曲线之上，文字不会压到曲线（推演直角的横边
    // 本就悬在数据区外，同理不压）
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = this._color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(this._label, (xL + xR) / 2, yLine + LABEL_GAP);
  }
}
