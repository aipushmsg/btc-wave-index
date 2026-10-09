// USDT.D 买卖区标注：多条水平半透明色带 + 区名文字。
// 上下镜像语义（见 config 阈值注释）：
//   高位带（8.9~10%）绿色 = USDT.D 高企，开始买入大饼；
//   低位带（0~4.2%）红色 = USDT.D 枯竭，开始卖出大饼。
// 挂在 USDT.D 系列上随窗格显隐迁移；只在自身窗格内绘制。
// 阈值线本体与轴上数值标签由 createPriceLine 提供，这里只负责
// 「区域感」与文字提示，避免两套线条重复。
import { Primitive } from './base.js';
import { FONT_MONO } from '../config.js';

export class UsdtZones extends Primitive {
  // zones: [{ lo, hi, label, textColor, zoneColor }]（lo/hi 顺序不限）
  constructor({ zones }) {
    super('bottom'); // 画在折线之下：色带是背景语境，不遮挡数据
    this._zones = zones;
  }

  _draw(ctx, media) {
    for (const z of this._zones) {
      const yLo = this.priceToY(z.lo);
      const yHi = this.priceToY(z.hi);
      if (yLo === null || yHi === null) continue;
      const top = Math.min(yLo, yHi);
      const h = Math.abs(yHi - yLo);
      // 色带：满宽水平条
      ctx.fillStyle = z.zoneColor;
      ctx.fillRect(0, top, media.width, h);
      // 区名：色带内部右缘垂直居中（右缘内缩避开折叠按钮）
      if (z.label) {
        ctx.font = `600 11px ${FONT_MONO}`;
        ctx.fillStyle = z.textColor;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(z.label, media.width - 46, top + h / 2);
      }
    }
  }
}
