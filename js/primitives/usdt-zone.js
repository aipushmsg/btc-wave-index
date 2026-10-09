// USDT.D 买入区标注：9% ~ 9.5% 的水平半透明色带 + 区名文字。
// 语义：USDT 市值占全加密市场比例高企 = 场外资金避险情绪达到极致 =
// 大饼被恐慌抛售至低估区（2022-12 峰值正是上轮熊市大底，见 config 阈值
// 注释）。挂在 USDT.D 系列上随窗格显隐迁移；只在自身窗格内绘制。
// 阈值线本体（9% / 9.5% 与轴上数值标签）由 createPriceLine 提供，这里
// 只负责「区域感」与文字提示，避免两套线条重复。
import { Primitive } from './base.js';
import { FONT_MONO } from '../config.js';

export class UsdtBuyZone extends Primitive {
  constructor({ buyLevel, strongLevel, label, textColor, zoneColor }) {
    super('bottom'); // 画在折线之下：色带是背景语境，不遮挡数据
    this._buy = buyLevel;
    this._strong = strongLevel;
    this._label = label;
    this._textColor = textColor;
    this._zoneColor = zoneColor;
  }

  _draw(ctx, media) {
    const yBuy = this.priceToY(this._buy);
    const yStrong = this.priceToY(this._strong);
    if (yBuy === null || yStrong === null) return;
    const top = Math.min(yBuy, yStrong);
    const h = Math.abs(yStrong - yBuy);
    // 买入区色带：满宽水平条，落在窗格数据区顶部（2~10% 轴域的 9~9.5%）
    ctx.fillStyle = this._zoneColor;
    ctx.fillRect(0, top, media.width, h);
    // 区名：色带内部右缘垂直居中（右缘内缩避开折叠按钮）
    if (this._label) {
      ctx.font = `600 11px ${FONT_MONO}`;
      ctx.fillStyle = this._textColor;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(this._label, media.width - 46, top + h / 2);
    }
  }
}
