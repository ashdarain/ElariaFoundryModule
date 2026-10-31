/**
 * Token resource bars.
 *
 * Foundry draws two bars: bar 1 at the bottom and bar 2 at the top (which attribute each shows, and when they're
 * visible, is set in the token's settings and by the GM, as usual). Elaria colours them by resource and adds a
 * third bar so all three fit:
 *   bottom: HP (red)         top: MP (blue), with FTG (green) stacked under it
 * FTG is drawn as the extra top bar whenever the token's two bars don't already show it. A resource with a
 * maximum of 0 (a monster with no mana) isn't drawn, and the next bar moves up.
 */

const BaseToken = foundry.canvas?.placeables?.Token ?? globalThis.Token;

const COLORS = {
  "resources.hp": 0xc0392b,
  "resources.mp": 0x2f6fc9,
  "resources.ftg": 0x4f9a3c
};
const EXTRA = "resources.ftg";

export class ElariaToken extends BaseToken {

  /** Bar height, as core works it out. */
  #barHeight() {
    let h = Math.max(canvas.dimensions.size / 12, 8);
    if (this.document.height >= 2) h *= 1.6;
    return h;
  }

  drawBars() {
    super.drawBars();
    const bars = this.bars;
    if (!bars || bars.destroyed) return;
    bars.elariaExtra ??= bars.addChild(new PIXI.Graphics());
    const extra = bars.elariaExtra;
    extra.visible = false;
    if (!this.actor || this.document.displayBars === CONST.TOKEN_DISPLAY_MODES.NONE) return;

    // Only add FTG if neither configured bar shows it and the actor has some.
    const shown = ["bar1", "bar2"].map(b => this.document[b]?.attribute);
    if (shown.includes(EXTRA)) return;
    const res = foundry.utils.getProperty(this.actor.system, EXTRA);
    if (!res || !(res.max > 0)) return;
    this.#paint(extra, { attribute: EXTRA, value: res.value, max: res.max }, this.#topSlot(1));
    extra.visible = true;
  }

  /** y position of the n-th top bar (0 = the very top), skipping bar 2 if it isn't visible. */
  #topSlot(index) {
    const h = this.#barHeight();
    const bar2Visible = !!this.bars?.bar2?.visible;
    return (bar2Visible ? index : index - 1) * h;
  }

  _drawBar(number, bar, data) {
    const color = COLORS[data?.attribute];
    if (color === undefined) return super._drawBar(number, bar, data);
    const y = number === 0 ? this.h - this.#barHeight() : 0;
    this.#paint(bar, data, y, color);
    return true;
  }

  #paint(bar, data, y, color = COLORS[data.attribute]) {
    const max = Number(data.max) || 0;
    const pct = max > 0 ? Math.clamp(Number(data.value) || 0, 0, max) / max : 0;
    const h = this.#barHeight();
    const w = this.w;
    const bs = Math.clamp(h / 8, 1, 2);
    const black = 0x000000;
    bar.clear();
    bar.lineStyle(bs, black, 1.0).beginFill(black, 0.5).drawRoundedRect(0, 0, w, h, 3);
    if (pct > 0) bar.beginFill(color, 1.0).lineStyle(bs, black, 1.0).drawRoundedRect(0, 0, pct * w, h, 2);
    bar.endFill();
    bar.position.set(0, y);
  }
}
