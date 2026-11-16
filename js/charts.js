/* Lightweight SVG line chart (with crosshair tooltip) and arc gauge. No dependencies. */
(function (OBD) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };

  class LineChart {
    /** opts: { title, series:[{key,label,color}], min, max, unitOf(), conv(v), digits, refs:[metricValue], windowMs } */
    constructor(container, opts) {
      this.o = Object.assign({ windowMs: 60000, digits: 0, refs: [] }, opts);
      this.root = document.createElement('div');
      this.root.className = 'chart';
      this.root.innerHTML = `<div class="chart-h"><h3>${opts.title}</h3><span class="now"></span></div>` +
        (opts.series.length > 1 ? `<div class="legend">${opts.series.map((s) => `<span style="--c:${s.color}">${s.label}</span>`).join('')}</div>` : '');
      container.appendChild(this.root);
      this.nowEl = this.root.querySelector('.now');
      this.svg = el('svg', { role: 'img', 'aria-label': opts.title }, this.root);
      this.gGrid = el('g', {}, this.svg);
      this.gRefs = el('g', {}, this.svg);
      this.paths = opts.series.map((s) => el('path', { class: 'line', stroke: s.color }, this.svg));
      this.ends = opts.series.map(() => el('text', { class: 'endlabel' }, this.svg));
      this.xhair = el('line', { class: 'xhair', visibility: 'hidden' }, this.svg);
      this.dots = opts.series.map((s) => el('circle', { class: 'dot', r: 4, fill: s.color, visibility: 'hidden' }, this.svg));
      this.tip = document.createElement('div'); this.tip.className = 'tip'; this.tip.hidden = true; this.root.appendChild(this.tip);
      this.hoverX = null;
      this.svg.addEventListener('pointermove', (e) => { const r = this.svg.getBoundingClientRect(); this.hoverX = e.clientX - r.left; this.drawHover(); });
      this.svg.addEventListener('pointerleave', () => { this.hoverX = null; this.drawHover(); });
    }

    fmt(v) { return v == null || isNaN(v) ? '—' : this.o.conv(v).toFixed(this.o.digits); }

    render(history, now) {
      const W = this.svg.clientWidth || 300, H = 130, padL = 34, padR = this.o.series.length > 1 ? 44 : 8, padT = 6, padB = 16;
      this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const t0 = now - this.o.windowMs;
      const conv = this.o.conv;
      let lo = this.o.min != null ? conv(this.o.min) : Infinity, hi = this.o.max != null ? conv(this.o.max) : -Infinity;
      if (this.o.min == null || this.o.max == null) {
        for (const s of this.o.series) for (const p of history[s.key] || []) {
          if (p.t < t0) continue;
          const v = conv(p.v);
          if (this.o.min == null) lo = Math.min(lo, v);
          if (this.o.max == null) hi = Math.max(hi, v);
        }
        if (!isFinite(lo)) lo = 0; if (!isFinite(hi)) hi = lo + 1;
        const pad = (hi - lo) * 0.15 || 1;
        if (this.o.min == null) lo -= pad; if (this.o.max == null) hi += pad;
      }
      const x = (t) => padL + (t - t0) / this.o.windowMs * (W - padL - padR);
      const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
      Object.assign(this, { x, y, t0, W, H, padL, padR, padT, padB, history, now });

      this.gGrid.innerHTML = '';
      for (let i = 0; i <= 2; i++) {
        const v = lo + (hi - lo) * i / 2, yy = y(v);
        el('line', { class: 'gridline', x1: padL, x2: W - padR, y1: yy, y2: yy }, this.gGrid);
        el('text', { class: 'axis', x: padL - 5, y: yy + 3, 'text-anchor': 'end' }, this.gGrid).textContent = Math.abs(hi - lo) < 5 ? v.toFixed(1) : Math.round(v);
      }
      el('text', { class: 'axis', x: padL, y: H - 2 }, this.gGrid).textContent = '-60s';
      el('text', { class: 'axis', x: W - padR, y: H - 2, 'text-anchor': 'end' }, this.gGrid).textContent = 'now';
      this.gRefs.innerHTML = '';
      for (const r of this.o.refs) {
        const yy = y(conv(r));
        if (yy >= padT && yy <= H - padB) el('line', { class: 'ref', x1: padL, x2: W - padR, y1: yy, y2: yy }, this.gRefs);
      }

      const nowTexts = [];
      this.o.series.forEach((s, i) => {
        const pts = (history[s.key] || []).filter((p) => p.t >= t0);
        this.paths[i].setAttribute('d', pts.map((p, j) => (j ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(conv(p.v)).toFixed(1)).join(''));
        const last = pts[pts.length - 1];
        nowTexts.push(last ? this.fmt(last.v) : '—');
        if (this.o.series.length > 1 && last) {
          this.ends[i].setAttribute('x', W - padR + 6);
          this.ends[i].setAttribute('y', y(conv(last.v)) + 4);
          this.ends[i].textContent = s.short || s.label;
        }
      });
      // avoid end-label collisions
      if (this.ends.length === 2) {
        const [a, b] = this.ends.map((e) => parseFloat(e.getAttribute('y')) || 0);
        if (Math.abs(a - b) < 12) { const m = (a + b) / 2, up = a < b ? 0 : 1; this.ends[up].setAttribute('y', m - 6); this.ends[1 - up].setAttribute('y', m + 7); }
      }
      this.nowEl.textContent = this.o.series.length === 1 ? `${nowTexts[0]} ${this.o.unitOf()}` : this.o.unitOf();
      this.drawHover();
    }

    drawHover() {
      const show = this.hoverX != null && this.x && this.hoverX >= this.padL && this.hoverX <= this.W - this.padR;
      this.xhair.setAttribute('visibility', show ? 'visible' : 'hidden');
      this.dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      this.tip.hidden = !show;
      if (!show) return;
      const t = this.t0 + (this.hoverX - this.padL) / (this.W - this.padL - this.padR) * this.o.windowMs;
      let rows = '', snapX = this.hoverX;
      this.o.series.forEach((s, i) => {
        const pts = this.history[s.key] || [];
        let best = null;
        for (const p of pts) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
        if (!best) return;
        snapX = this.x(best.t);
        this.dots[i].setAttribute('cx', snapX); this.dots[i].setAttribute('cy', this.y(this.o.conv(best.v)));
        this.dots[i].setAttribute('visibility', 'visible');
        rows += `<div class="r"><span><span class="sw" style="background:${s.color}"></span>${s.label}</span><b>${this.fmt(best.v)} ${this.o.unitOf()}</b></div>`;
      });
      this.xhair.setAttribute('x1', snapX); this.xhair.setAttribute('x2', snapX);
      this.xhair.setAttribute('y1', this.padT); this.xhair.setAttribute('y2', this.H - this.padB);
      this.tip.innerHTML = `<div class="t">${((this.now - t) / 1000).toFixed(1)} s ago</div>${rows}`;
      const tw = this.tip.offsetWidth || 120;
      this.tip.style.left = Math.min(Math.max(0, snapX + 10), this.W - tw) + 'px';
      this.tip.style.top = '30px';
    }
  }

  class Gauge {
    /** opts: { label, min, max (metric), zones:[{from,to,status}], conv, unitOf, digits, scaleDigits } */
    constructor(container, opts) {
      this.o = Object.assign({ digits: 0 }, opts);
      this.root = document.createElement('div');
      this.root.className = 'gauge';
      container.appendChild(this.root);
      const svg = el('svg', { viewBox: '0 0 200 156', role: 'img', 'aria-label': opts.label }, this.root);
      this.R = 80; this.cx = 100; this.cy = 100; this.sweep = 240;
      const arc = (a0, a1) => this.arcPath(a0, a1);
      el('path', { d: arc(0, 1), class: 'track', fill: 'none', 'stroke-width': 12, 'stroke-linecap': 'round' }, svg);
      for (const z of opts.zones || []) {
        if (z.status === 'good') continue;
        el('path', { d: this.arcPath(this.frac(z.from), this.frac(z.to), this.R + 11), class: 'zone', fill: 'none', stroke: `var(--${z.status})`, 'stroke-width': 3 }, svg);
      }
      this.len = Math.PI * 2 * this.R * this.sweep / 360;
      this.valArc = el('path', { d: arc(0, 1), class: 'val-arc', fill: 'none', stroke: 'var(--accent)', 'stroke-width': 12, 'stroke-linecap': 'round',
        'stroke-dasharray': this.len, 'stroke-dashoffset': this.len }, svg);
      this.valText = el('text', { x: 100, y: 98, 'text-anchor': 'middle', class: 'g-val' }, svg);
      this.unitText = el('text', { x: 100, y: 116, 'text-anchor': 'middle', class: 'g-unit' }, svg);
      this.minText = el('text', { x: 31, y: 155, 'text-anchor': 'middle', class: 'g-scale' }, svg);
      this.maxText = el('text', { x: 169, y: 155, 'text-anchor': 'middle', class: 'g-scale' }, svg);
      this.labelEl = document.createElement('div'); this.labelEl.className = 'g-label'; this.labelEl.textContent = opts.label;
      this.statusEl = document.createElement('div');
      this.root.append(this.labelEl, this.statusEl);
      this.set(null, null);
    }
    frac(v) { return Math.max(0, Math.min(1, (v - this.o.min) / (this.o.max - this.o.min))); }
    arcPath(f0, f1, R = this.R) {
      const start = 150 + f0 * this.sweep, end = 150 + f1 * this.sweep;
      const p = (a) => [this.cx + R * Math.cos(a * Math.PI / 180), this.cy + R * Math.sin(a * Math.PI / 180)];
      const [x0, y0] = p(start), [x1, y1] = p(end);
      return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${end - start > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    }
    set(v, status) {
      const c = this.o.conv;
      this.minText.textContent = c(this.o.min).toFixed(this.o.scaleDigits || 0);
      this.maxText.textContent = c(this.o.max).toFixed(this.o.scaleDigits || 0);
      this.unitText.textContent = this.o.unitOf();
      if (v == null) { this.valText.textContent = '—'; this.valArc.setAttribute('stroke-dashoffset', this.len); this.statusEl.innerHTML = ''; return; }
      this.valText.textContent = c(v).toFixed(this.o.digits);
      this.valArc.setAttribute('stroke-dashoffset', this.len * (1 - this.frac(v)));
      this.valArc.setAttribute('stroke', status && status.level !== 'good' ? `var(--${status.level})` : 'var(--accent)');
      this.statusEl.innerHTML = status ? OBD.statusHtml(status) : '';
    }
  }

  Object.assign(OBD, { LineChart, Gauge });
})(window.OBD = window.OBD || {});
