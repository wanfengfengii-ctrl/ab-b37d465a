// app.mjs —— 前端交互：草稿录入、报告即时撤销、平面图与明细渲染
import {
  certify, polygonArea, popcount, rectVertices,
} from './geometry.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------- 草稿状态 ----------------
const presets = {
  pass: {
    site: rectSite(),
    strips: [
      { name: '带1-下段', cx: 50, cy: 17, width: 100, height: 34, angle: 0 },
      { name: '带2-中段', cx: 50, cy: 51, width: 100, height: 34, angle: 0 },
      { name: '带3-上段', cx: 50, cy: 85, width: 100, height: 34, angle: 0 },
    ],
  },
  gap: {
    site: rectSite(),
    strips: [
      { name: 'S1', cx: 50, cy: 15, width: 100, height: 30, angle: 0 },
      { name: 'S2', cx: 50, cy: 50, width: 100, height: 30, angle: 0 },
      { name: 'S3', cx: 50, cy: 85, width: 100, height: 30, angle: 0 },
    ],
  },
  triple: {
    site: rectSite(),
    strips: [
      { name: 'A', cx: 50, cy: 30, width: 100, height: 60, angle: 0 },
      { name: 'B', cx: 50, cy: 70, width: 100, height: 60, angle: 0 },
      { name: 'C', cx: 50, cy: 50, width: 100, height: 60, angle: 0 },
    ],
  },
};

function rectSite() {
  return [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ];
}

let draft = structuredClone(presets.gap);
// report === null 表示当前无有效报告（草稿一变即撤销）
let report = null;

// ---------------- DOM ----------------
const $ = (id) => document.getElementById(id);
const siteRowsEl = $('siteRows');
const stripRowsEl = $('stripRows');
const revokeNote = $('revokeNote');
const verdictEl = $('verdict');
const svgEl = $('plan');
const meshToggle = $('meshToggle');

function inputCell(value, oninput, placeholder = '') {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.value = value ?? '';
  inp.placeholder = placeholder;
  inp.addEventListener('input', oninput);
  return inp;
}

function renderSiteRows() {
  siteRowsEl.innerHTML = '';
  draft.site.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'row site';
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = `V${i + 1}`;
    row.append(
      idx,
      inputCell(v.x, (e) => mutate(() => { v.x = e.target.value; })),
      inputCell(v.y, (e) => mutate(() => { v.y = e.target.value; })),
      deleteButton(() => { draft.site.splice(i, 1); }),
    );
    siteRowsEl.appendChild(row);
  });
}

function renderStripRows() {
  stripRowsEl.innerHTML = '';
  draft.strips.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'row strip';
    const name = document.createElement('input');
    name.type = 'text';
    name.value = s.name;
    name.addEventListener('input', (e) => mutate(() => { s.name = e.target.value; }));
    row.append(
      name,
      inputCell(s.cx, (e) => mutate(() => { s.cx = e.target.value; })),
      inputCell(s.cy, (e) => mutate(() => { s.cy = e.target.value; })),
      inputCell(s.width, (e) => mutate(() => { s.width = e.target.value; })),
      inputCell(s.height, (e) => mutate(() => { s.height = e.target.value; })),
      inputCell(s.angle ?? 0, (e) => mutate(() => { s.angle = e.target.value; })),
      deleteButton(() => { draft.strips.splice(i, 1); }),
    );
    stripRowsEl.appendChild(row);
  });
  $('stripCountHint').textContent = `当前 ${draft.strips.length} 条（允许 3–12）`;
}

function deleteButton(onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'del';
  b.textContent = '✕';
  b.title = '删除';
  b.addEventListener('click', () => { mutate(onclick, true); });
  return b;
}

// 草稿变更：撤销旧报告 →（按需）重建录入行 → 只渲染草稿平面图
// 参数输入不重建行，避免输入中失焦；增删行才重建。
function mutate(fn, rebuildRows = false) {
  fn();
  revokeReport();
  if (rebuildRows) {
    renderSiteRows();
    renderStripRows();
  } else {
    $('stripCountHint').textContent = `当前 ${draft.strips.length} 条（允许 3–12）`;
  }
  renderDraftOnly();
}

function revokeReport() {
  if (report !== null) {
    report = null;
    revokeNote.classList.remove('hidden');
  }
  verdictEl.className = 'verdict idle';
  verdictEl.textContent = '尚未认证：编辑草稿后点击「发起认证」。';
  $('summary').className = 'summary muted';
  $('summary').textContent = '暂无报告';
  $('risks').className = 'risks muted';
  $('risks').textContent = '暂无报告';
  document.querySelector('#stripTable tbody').innerHTML = '';
}

$('addSiteVertex').addEventListener('click', () => {
  mutate(() => {
    const last = draft.site[draft.site.length - 1] ?? { x: 0, y: 0 };
    draft.site.push({ x: last.x, y: last.y });
  }, true);
});
$('addStrip').addEventListener('click', () => {
  mutate(() => {
    if (draft.strips.length >= 12) return;
    draft.strips.push({
      name: `带${draft.strips.length + 1}`,
      cx: 50, cy: 50, width: 40, height: 20, angle: 0,
    });
  }, true);
});
document.querySelectorAll('.presets button').forEach((btn) => {
  btn.addEventListener('click', () => {
    draft = structuredClone(presets[btn.dataset.preset]);
    revokeReport();
    revokeNote.classList.add('hidden'); // 载入预设不算“修改旧草稿”
    renderSiteRows();
    renderStripRows();
    renderDraftOnly();
  });
});

$('certifyBtn').addEventListener('click', () => {
  const site = draft.site.map((v) => ({ x: Number(v.x), y: Number(v.y) }));
  const strips = draft.strips.map((s) => ({
    name: s.name || '未命名',
    cx: Number(s.cx), cy: Number(s.cy),
    width: Number(s.width), height: Number(s.height),
    angle: s.angle === '' || s.angle == null ? 0 : Number(s.angle),
  }));
  const res = certify(site, strips);
  if (res.status === 'invalid') {
    report = null;
    revokeNote.classList.add('hidden');
    verdictEl.className = 'verdict invalid';
    verdictEl.innerHTML = '草稿无法认证：<br>' + res.errors.map((e) => `· ${e}`).join('<br>');
    renderDraftOnly();
    return;
  }
  report = res;
  revokeNote.classList.add('hidden');
  renderReport(res);
});

meshToggle.addEventListener('change', () => {
  if (report) renderReport(report);
  else renderDraftOnly();
});

// ---------------- SVG 平面图 ----------------
function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function computeView(polys, w = 820, h = 560, pad = 60) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 100; maxY = 100; }
  const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const offX = (w - spanX * scale) / 2 - minX * scale;
  const offY = (h - spanY * scale) / 2 - minY * scale;
  return {
    scale, offX, offY,
    T: (p) => ({ x: p.x * scale + offX, y: h - (p.y * scale + offY) }),
  };
}

const pts = (poly, T) => poly.map((p) => { const q = T(p); return `${q.x.toFixed(2)},${q.y.toFixed(2)}`; }).join(' ');

const STRIP_COLORS = ['#5696ea', '#4fc3f7', '#7980cb', '#4dd0e1', '#64b5f6', '#9fa8da',
  '#82b1ff', '#448aff', '#5c6bc0', '#26c6da', '#29b6f6', '#3949ab'];

function renderDraftOnly() {
  const site = draft.site.length >= 3
    ? draft.site.map((v) => ({ x: Number(v.x) || 0, y: Number(v.y) || 0 }))
    : null;
  // 用草稿矩形参数本地构造几何，不依赖已有报告
  const stripPolys = draft.strips.map((s) =>
    rectVertices(Number(s.cx) || 0, Number(s.cy) || 0, Number(s.width) || 1, Number(s.height) || 1, Number(s.angle) || 0));
  const view = computeView([...(site ? [site] : []), ...stripPolys]);
  paint(view, { site, stripPolys, labels: draft.strips.map((s) => s.name) });
  if (!report) {
    $('summary').className = 'summary muted';
    $('summary').textContent = '暂无报告';
    $('risks').className = 'risks muted';
    $('risks').textContent = '暂无报告';
  }
}

function paint(view, { site, stripPolys, cells, risks }) {
  svgEl.innerHTML = '';
  const T = view.T;

  // 切分单元（连续平面划分的可视化）
  if (cells && meshToggle.checked) {
    for (const c of cells) {
      const k = popcount(c.coverMask);
      const fill = c.coverMask === 0 ? 'rgba(255,112,67,0.30)'
        : k >= 3 ? 'rgba(229,55,111,0.40)'
        : k === 2 ? 'rgba(90,180,140,0.18)'
        : 'rgba(86,150,234,0.10)';
      svgEl.appendChild(el('polygon', {
        points: pts(c.poly, T), fill, stroke: '#334155', 'stroke-width': 0.6,
      }));
    }
  }

  // 覆盖带
  stripPolys.forEach((poly, i) => {
    const color = STRIP_COLORS[i % STRIP_COLORS.length];
    svgEl.appendChild(el('polygon', {
      points: pts(poly, T),
      fill: color, 'fill-opacity': 0.16,
      stroke: color, 'stroke-width': 1.4,
    }));
    const c = centroidOf(poly);
    const q = T(c);
    const t = el('text', {
      x: q.x, y: q.y, fill: '#cfe1fb', 'font-size': 11,
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-weight': 600,
    }, `${i + 1}`);
    svgEl.appendChild(t);
  });

  // 风险区域
  if (risks) {
    for (const r of risks.areaRisks) {
      const color = r.kind === 'gap' ? '#ff7043' : '#e5376f';
      svgEl.appendChild(el('polygon', {
        points: pts(r.polygon, T),
        fill: color, 'fill-opacity': 0.45,
        stroke: color, 'stroke-width': 1.6, 'stroke-dasharray': '5 3',
      }));
      const q = T(r.centroid);
      svgEl.appendChild(el('text', {
        x: q.x, y: q.y, fill: '#fff', 'font-size': 11, 'text-anchor': 'middle',
        'font-weight': 700, 'dominant-baseline': 'middle',
      }, r.kind === 'gap' ? '漏' : '三'));
    }
    for (const b of risks.boundaryRisks) {
      const a = T(b.segment[0]), c = T(b.segment[1]);
      svgEl.appendChild(el('line', {
        x1: a.x, y1: a.y, x2: c.x, y2: c.y,
        stroke: '#ff4d88', 'stroke-width': 4, 'stroke-linecap': 'round',
      }));
    }
    for (const p of risks.pointRisks) {
      const q = T(p.point);
      svgEl.appendChild(el('circle', { cx: q.x, cy: q.y, r: 5, fill: '#ff4d88', stroke: '#fff', 'stroke-width': 1 }));
    }
  }

  // 工作区边界（最上层）
  if (site && site.length >= 3) {
    svgEl.appendChild(el('polygon', {
      points: pts(site, T),
      fill: 'none', stroke: '#dce9fb', 'stroke-width': 2.4,
    }));
    site.forEach((p, i) => {
      const q = T(p);
      svgEl.appendChild(el('circle', { cx: q.x, cy: q.y, r: 3, fill: '#dce9fb' }));
      svgEl.appendChild(el('text', {
        x: q.x + 7, y: q.y - 7, fill: '#aebfd4', 'font-size': 10,
      }, `V${i + 1}`));
    });
  }

  // 比例尺
  const scaleLen = niceScale(view.scale);
  const barX = 24, barY = 532;
  svgEl.appendChild(el('line', { x1: barX, y1: barY, x2: barX + scaleLen.metres * view.scale, y2: barY, stroke: '#cfd9e6', 'stroke-width': 3 }));
  svgEl.appendChild(el('text', { x: barX, y: barY - 6, fill: '#cfd9e6', 'font-size': 11 }, `${scaleLen.metres} m`));
}

function niceScale(scale) {
  const target = 90; // px
  const raw = target / scale;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= raw) return { metres: m * pow };
  }
  return { metres: 10 * pow };
}

function centroidOf(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: y / poly.length };
}

// ---------------- 报告渲染 ----------------
function renderReport(res) {
  const risks = {
    areaRisks: [...res.gaps, ...res.triples],
    boundaryRisks: res.boundaryTriples,
    pointRisks: res.pointTriples,
  };
  const view = computeView([res.site, ...res.strips.map((s) => s.poly)]);
  paint(view, {
    site: res.site,
    stripPolys: res.strips.map((s) => s.poly),
    cells: res.cells,
    risks,
  });

  if (res.status === 'pass') {
    verdictEl.className = 'verdict pass';
    verdictEl.innerHTML =
      '✔ 认证通过：发掘区每一点至少被 1 条覆盖带覆盖，且任一点至多被 2 条覆盖带覆盖（边界接触已计入）。';
  } else {
    verdictEl.className = 'verdict risk';
    const k = res.firstRisk;
    const typeName = { gap: '漏拍', triple: '三重曝光', 'triple-boundary': '零面积三重边界接触', 'triple-point': '零面积三重点接触' }[k.kind];
    verdictEl.innerHTML =
      `✘ 认证不通过：发现风险。首个风险区域类型＝<b>${typeName}</b>，面积＝<b>${fmtA(k.area)}</b> m²` +
      (k.length ? `，接触段长＝<b>${k.length.toFixed(3)}</b> m` : '') +
      `，位置＝(${k.centroid.x.toFixed(2)}, ${k.centroid.y.toFixed(2)})。详见下方边界证据。`;
  }

  // 汇总
  const sum = $('summary');
  sum.className = 'summary';
  const onceOrTwice = res.siteArea - res.gapArea - res.tripleArea;
  sum.innerHTML = `
    <div>发掘区总面积：<span class="big">${fmtA(res.siteArea)}</span> m²</div>
    <div>漏拍面积：<b style="color:var(--gap)">${fmtA(res.gapArea)}</b> m²
      （占比 ${pct(res.gapArea, res.siteArea)}）</div>
    <div>三重及以上曝光面积：<b style="color:var(--triple)">${fmtA(res.tripleArea)}</b> m²
      （占比 ${pct(res.tripleArea, res.siteArea)}）</div>
    <div>恰被 1–2 条带覆盖面积：${fmtA(onceOrTwice)} m²</div>
    <div>零面积三重接触：共线段 ${res.boundaryTriples.length} 处，点 ${res.pointTriples.length} 处</div>
    <div class="hint">连续切分单元数：${res.cells.length}；面积闭合误差：${res.areaBalanceError.toExponential(2)} m²（应≈0，证明无栅格近似损失）</div>
  `;

  // 各带明细
  const insideArea = insideAreas(res);
  const tb = document.querySelector('#stripTable tbody');
  tb.innerHTML = '';
  res.strips.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class="name">${s.name}</td>
      <td>(${s.cx}, ${s.cy})</td>
      <td>${s.width} × ${s.height}</td>
      <td>${s.angle}°</td>
      <td>${fmtA(polygonArea(s.poly))}</td>
      <td>${fmtA(insideArea[i])}</td>`;
    tb.appendChild(tr);
  });

  // 风险卡片
  renderRisks(res);
}

function insideAreas(res) {
  // 带在发掘区内的精确面积 = 含该带掩码的切分单元面积之和
  const arr = res.strips.map(() => 0);
  for (const c of res.cells) {
    const a = polygonArea(c.poly);
    arr.forEach((_, i) => { if (c.coverMask & (1 << i)) arr[i] += a; });
  }
  return arr;
}

function renderRisks(res) {
  const box = $('risks');
  const all = [
    ...res.gaps,
    ...res.triples,
    ...res.boundaryTriples,
    ...res.pointTriples,
  ];
  box.className = 'risks';
  if (!all.length) {
    box.classList.add('muted');
    box.textContent = '无风险区域：无漏拍、无三重曝光（含边界接触）。';
    return;
  }
  const typeName = {
    gap: '漏拍区（0 条覆盖带）',
    triple: '三重曝光区（≥3 条覆盖带）',
    'triple-boundary': '零面积三重边界接触',
    'triple-point': '零面积三重点接触',
  };
  box.innerHTML = '';
  all.forEach((r, idx) => {
    const card = document.createElement('div');
    card.className = `risk-card ${r.kind}`;
    const isFirst = res.firstRisk === r;
    let body = '';
    if (r.kind === 'gap' || r.kind === 'triple') {
      body = `
        <div class="rmeta">面积：<b>${fmtA(r.area)}</b> m²
          ｜重心：(${r.centroid.x.toFixed(2)}, ${r.centroid.y.toFixed(2)})
          ${r.multiplicity ? `｜覆盖重数：${r.multiplicity}` : ''}</div>
        ${r.coverStrips && r.coverStrips.length ? `<div class="rmeta">参与覆盖带：${r.coverStrips.join('、')}</div>` : ''}
        <div class="rmeta">边界证据（风险多边形逐边来源）：</div>
        <ul>${r.evidence.map((e) =>
          `<li>${e.source}；边长 ${e.length.toFixed(3)} m，端点 (${e.from.x.toFixed(2)},${e.from.y.toFixed(2)}) → (${e.to.x.toFixed(2)},${e.to.y.toFixed(2)})</li>`).join('')}</ul>`;
    } else if (r.kind === 'triple-boundary') {
      body = `
        <div class="rmeta">共线重叠段长：<b>${r.length.toFixed(3)}</b> m，面积 0 m²
          ｜中点：(${r.centroid.x.toFixed(2)}, ${r.centroid.y.toFixed(2)})</div>
        <div class="rmeta">参与覆盖带：${r.coverStrips.join('、')}</div>
        <ul>${r.evidence.map((e) => `<li>${e.source}</li>`).join('')}</ul>`;
    } else {
      body = `
        <div class="rmeta">接触点：(${r.point.x.toFixed(3)}, ${r.point.y.toFixed(3)})，面积 0 m²</div>
        <div class="rmeta">参与覆盖带：${r.coverStrips.join('、')}</div>
        <ul>${r.evidence.map((e) => `<li>${e.source}</li>`).join('')}</ul>`;
    }
    card.innerHTML =
      `<div class="rtitle">${idx + 1}. ${typeName[r.kind] || r.kind}${isFirst ? '<span class="first-badge">首个风险</span>' : ''}</div>${body}`;
    box.appendChild(card);
  });
}

const fmtA = (x) => (Math.abs(x) < 1e-8 ? '0' : x.toFixed(3));
const pct = (a, total) => (total > 0 ? `${((a / total) * 100).toFixed(2)}%` : '—');

// ---------------- 初始化 ----------------
renderSiteRows();
renderStripRows();
renderDraftOnly();
