// 自动生成，请勿编辑。由 scripts/build.mjs 内联 src/ 下模块构建。
(function () {
'use strict';

// ===== 内联模块：geometry.mjs =====
// geometry.mjs —— 连续平面判定核心（零依赖，浏览器 / Node 通用）
//
// 方法：把工作区（逆时针凸多边形）依次用每条矩形覆盖带的 4 条有向边做
// 凸多边形半平面二分切割，得到一组互不重叠的凸“单元”。每个单元维护
// 覆盖它的覆盖带位图 coverMask。由于所有切割线恰为各带边界，单元内部
// 覆盖带集合恒定，因此判定是精确的连续平面判定（非栅格、非固定采样）：
//   coverMask = 0   → 漏拍区
//   popcount ≥ 3    → 三重曝光区
// 边界接触计入覆盖（半平面裁剪闭包 inclusive）。
// 另对零面积情形做两类边界扫描：
//   · 三条带边界在发掘区内共线重叠 → triple-boundary
//   · 三条带仅在一点接触（含 T 字接头）→ triple-point

const EPS = 1e-9;

// ---------- 基础工具 ----------

const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const polygonArea = (pts) => Math.abs(signedArea(pts));

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function popcount(n) {
  let c = 0;
  while (n) { n &= n - 1; c++; }
  return c;
}

// 凸多边形面积重心（风险区域标识点）
function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < EPS) {
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

// ---------- 矩形构造 ----------
// 整数中心、宽高（整数）、角度（度）。顶点逆时针。
function rectVertices(cx, cy, w, h, angleDeg) {
  const a = ((Number(angleDeg) || 0) * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const local = [
    { x: -w / 2, y: -h / 2 },
    { x:  w / 2, y: -h / 2 },
    { x:  w / 2, y:  h / 2 },
    { x: -w / 2, y:  h / 2 },
  ];
  return local.map((p) => ({
    x: cx + p.x * ca - p.y * sa,
    y: cy + p.x * sa + p.y * ca,
  }));
}

// ---------- 凸多边形半平面二分切割 ----------
// 保留 cross(A,B,P) >= -EPS 的一侧（有向边 A→B 左侧闭包，边界接触保留）。
function clipConvex(poly, A, B) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const P = poly[i];
    const Q = poly[(i + 1) % n];
    const dp = cross(A, B, P);
    const dq = cross(A, B, Q);
    const pin = dp >= -EPS;
    const qin = dq >= -EPS;
    if (pin) out.push(P);
    if (pin !== qin) {
      const t = dp / (dp - dq);
      out.push({ x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t });
    }
  }
  const cleaned = [];
  for (const p of out) {
    if (!cleaned.length || dist(cleaned[cleaned.length - 1], p) > 1e-8) cleaned.push(p);
  }
  if (cleaned.length > 1 && dist(cleaned[0], cleaned[cleaned.length - 1]) <= 1e-8) cleaned.pop();
  return cleaned;
}

// ---------- 单元切分 ----------
// 两阶段：
//  1) 用所有覆盖带的全部边所在直线，把工作区递归二分为满维凸单元；
//  2) 用每个单元重心判定覆盖带位图（满维单元的重心不可能落在切割线上，
//     归属无歧义；边界闭包的覆盖关系由“边界接触计入”规则单独保证）。
function tessellate(site, strips) {
  const siteCCW = signedArea(site) < 0 ? [...site].reverse() : site.map((p) => ({ ...p }));

  const lines = [];
  strips.forEach((r) => {
    r.poly.forEach((A, k) => {
      lines.push({ A, B: r.poly[(k + 1) % r.poly.length] });
    });
  });

  let cells = [{ poly: siteCCW, coverMask: 0 }];
  for (const { A, B } of lines) {
    const next = [];
    for (const cell of cells) {
      const ds = cell.poly.map((P) => cross(A, B, P));
      const allIn = ds.every((d) => d >= -EPS);
      const allOut = ds.every((d) => d <= EPS);
      if (allIn && allOut) continue;            // 整体退化在切割线上：丢弃（零面积）
      if (allIn) { next.push(cell); continue; } // 仅贴线或全在内侧：不分裂
      if (allOut) { next.push(cell); continue; }
      const inside = clipConvex(cell.poly, A, B);
      const outside = clipConvex(cell.poly, B, A);
      if (inside.length >= 3 && polygonArea(inside) > 1e-14) next.push({ poly: inside });
      if (outside.length >= 3 && polygonArea(outside) > 1e-14) next.push({ poly: outside });
    }
    cells = next;
  }

  for (const cell of cells) {
    const c = centroid(cell.poly);
    let mask = 0;
    strips.forEach((r, i) => {
      if (pointInConvex(c, r.poly)) mask |= 1 << i;
    });
    cell.coverMask = mask;
  }
  return cells;
}

// ---------- 线段 / 多边形工具 ----------
function pointInConvex(P, poly, tol = -EPS) {
  for (let i = 0; i < poly.length; i++) {
    if (cross(poly[i], poly[(i + 1) % poly.length], P) < tol) return false;
  }
  return true;
}

function segIntersect(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

// 线段与凸多边形（含边界）的交，返回两端点或 null
function segmentInPolygon(A, B, poly) {
  let pts = [];
  if (pointInConvex(A, poly)) pts.push({ ...A });
  if (pointInConvex(B, poly)) pts.push({ ...B });
  for (let i = 0; i < poly.length; i++) {
    const ip = segIntersect(A, B, poly[i], poly[(i + 1) % poly.length]);
    if (ip) pts.push(ip);
  }
  if (pts.length < 2) return null;
  const uniq = [];
  for (const p of pts) {
    if (!uniq.some((q) => dist(p, q) <= 1e-7)) uniq.push(p);
  }
  if (uniq.length < 2) return null;
  const proj = uniq
    .map((p) => ({ p, t: (p.x - A.x) * (B.x - A.x) + (p.y - A.y) * (B.y - A.y) }))
    .sort((a, b) => a.t - b.t);
  return [proj[0].p, proj[proj.length - 1].p];
}

// 两线段是否共线且区间有正长度重叠（允许一方包含另一方）
function segmentsCoincide(A, B, C, D) {
  if (Math.abs(cross(A, B, C)) > 1e-6 || Math.abs(cross(A, B, D)) > 1e-6) return false;
  const ex = B.x - A.x, ey = B.y - A.y;
  const tC = ((C.x - A.x) * ex + (C.y - A.y) * ey);
  const tD = ((D.x - A.x) * ex + (D.y - A.y) * ey);
  const L2 = ex * ex + ey * ey;
  return Math.max(0, Math.min(tC, tD)) < Math.min(L2, Math.max(tC, tD)) - 1e-6;
}

// ---------- 零面积三重边界：共线重叠段 ----------
function boundaryTripleOverlaps(site, strips) {
  const groups = new Map();

  const addSegment = (A, B, owner) => {
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy);
    if (len < EPS) return;
    let ux = dx / len, uy = dy / len;
    let nx = -uy, ny = ux;
    let d = nx * A.x + ny * A.y;
    // 法向符号归一
    if (ny < -EPS || (Math.abs(ny) <= EPS && nx < 0)) { nx = -nx; ny = -ny; d = -d; }
    // 切向符号归一，保证参数区间可比
    let dirX = ux, dirY = uy;
    if (uy < -EPS || (Math.abs(uy) <= EPS && ux < 0)) { dirX = -ux; dirY = -uy; }
    // 参数原点统一取原点到该直线的垂足，同一支撑线上的段方可比较
    const base = { x: nx * d, y: ny * d };
    const pa = (A.x - base.x) * dirX + (A.y - base.y) * dirY;
    const pb = (B.x - base.x) * dirX + (B.y - base.y) * dirY;
    const key = `${Math.round(nx * 1e9)}|${Math.round(ny * 1e9)}|${Math.round(d * 1e9)}`;
    if (!groups.has(key)) {
      groups.set(key, { nx, ny, d, dirX, dirY, base, segs: [] });
    }
    groups.get(key).segs.push({ lo: Math.min(pa, pb), hi: Math.max(pa, pb), owner });
  };

  strips.forEach((r, ri) => {
    r.poly.forEach((A, k) => {
      const seg = segmentInPolygon(A, r.poly[(k + 1) % r.poly.length], site);
      if (seg) addSegment(seg[0], seg[1], ri);
    });
  });

  const findings = [];
  for (const g of groups.values()) {
    if (new Set(g.segs.map((s) => s.owner)).size < 3) continue;
    const events = [];
    g.segs.forEach((s) => {
      events.push({ t: s.lo, owner: s.owner, kind: 1 });
      events.push({ t: s.hi, owner: s.owner, kind: -1 });
    });
    // 起点先加、终点后撤：闭区间接触也计入
    events.sort((e1, e2) => e1.t - e2.t || e2.kind - e1.kind);
    const active = new Set();
    let start = null;
    let startOwners = null;
    for (const e of events) {
      const before = active.size;
      if (e.kind === 1) active.add(e.owner);
      else active.delete(e.owner);
      const now = active.size;
      if (before < 3 && now >= 3) { start = e.t; startOwners = new Set(active); }
      if (before >= 3 && now < 3 && start !== null) {
        if (e.t - start > 1e-7) {
          findings.push({
            type: 'triple-boundary',
            area: 0,
            length: e.t - start,
            a: { x: g.base.x + g.dirX * start, y: g.base.y + g.dirY * start },
            b: { x: g.base.x + g.dirX * e.t, y: g.base.y + g.dirY * e.t },
            line: { nx: g.nx, ny: g.ny, d: g.d },
            owners: [...startOwners],
          });
        }
        start = null;
        startOwners = null;
      }
    }
  }
  return findings;
}

// ---------- 零面积三重边界：单点接触 ----------
function triplePointContacts(site, strips, areaTriples, boundaryTriples) {
  const candidates = [];
  const push = (p) => {
    if (pointInConvex(p, site) && !candidates.some((q) => dist(q, p) <= 1e-6)) candidates.push(p);
  };
  strips.forEach((r) => r.poly.forEach((v) => push(v)));
  site.forEach((v) => push(v));
  for (let i = 0; i < strips.length; i++) {
    for (let j = i + 1; j < strips.length; j++) {
      strips[i].poly.forEach((A, k) => {
        const B = strips[i].poly[(k + 1) % 4];
        strips[j].poly.forEach((C, m) => {
          const ip = segIntersect(A, B, C, strips[j].poly[(m + 1) % 4]);
          if (ip) push(ip);
        });
      });
    }
  }
  for (let i = 0; i < strips.length; i++) {
    strips[i].poly.forEach((A, k) => {
      const B = strips[i].poly[(k + 1) % 4];
      site.forEach((C, m) => {
        const ip = segIntersect(A, B, C, site[(m + 1) % site.length]);
        if (ip) push(ip);
      });
    });
  }

  const distToSeg = (P, A, B) => {
    const l2 = (B.x - A.x) ** 2 + (B.y - A.y) ** 2;
    if (l2 < EPS) return dist(P, A);
    const t = Math.max(0, Math.min(1, ((P.x - A.x) * (B.x - A.x) + (P.y - A.y) * (B.y - A.y)) / l2));
    return dist(P, { x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y) });
  };

  const findings = [];
  for (const p of candidates) {
    const owners = [];
    strips.forEach((r, ri) => {
      // 边界接触计入：点在矩形内或边上
      if (pointInConvex(p, r.poly, -1e-7)) owners.push(ri);
    });
    if (owners.length < 3) continue;
    // 排除已属于面积型三重区或共线重叠段的点
    if (areaTriples.some((poly) => pointInConvex(p, poly, -1e-7))) continue;
    if (boundaryTriples.some((bt) => distToSeg(p, bt.a, bt.b) <= 1e-6)) continue;
    findings.push({ type: 'triple-point', area: 0, point: p, owners });
  }
  return findings;
}

// ---------- 认证主流程 ----------
function buildStrips(inputs) {
  return inputs.map((s) => ({
    ...s,
    angle: Number(s.angle) || 0,
    poly: rectVertices(Number(s.cx), Number(s.cy), Number(s.width), Number(s.height), Number(s.angle) || 0),
  }));
}

function certify(siteInput, stripInputs) {
  const errors = validateInput(siteInput, stripInputs);
  if (errors.length) {
    return { ok: false, status: 'invalid', errors, gaps: [], triples: [], cells: [], boundaryTriples: [], pointTriples: [] };
  }
  const site = siteInput.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
  const siteCCW = signedArea(site) < 0 ? [...site].reverse() : site;
  const strips = buildStrips(stripInputs);
  const siteArea = polygonArea(siteCCW);

  const cells = tessellate(siteCCW, strips);

  const gapCells = [];
  const tripleCells = [];
  for (const cell of cells) {
    const area = polygonArea(cell.poly);
    const k = popcount(cell.coverMask);
    if (cell.coverMask === 0) gapCells.push({ cell, area });
    else if (k >= 3) tripleCells.push({ cell, area, multiplicity: k });
  }

  const totalCellArea = cells.reduce((s, c) => s + polygonArea(c.poly), 0);
  const gapArea = gapCells.reduce((s, g) => s + g.area, 0);
  const tripleArea = tripleCells.reduce((s, g) => s + g.area, 0);

  const boundaryTriples = boundaryTripleOverlaps(siteCCW, strips);
  const areaTriplePolys = tripleCells.map((g) => g.cell.poly);
  const pointTriples = triplePointContacts(siteCCW, strips, areaTriplePolys, boundaryTriples);

  const toRisk = (g, kind) => ({
    kind,
    area: g.area,
    multiplicity: g.multiplicity,
    polygon: g.cell.poly,
    centroid: centroid(g.cell.poly),
    coverStrips: g.multiplicity
      ? strips.map((_, i) => i).filter((i) => (g.cell.coverMask & (1 << i))).map(stripLabel(strips))
      : [],
    evidence: edgeEvidence(g.cell.poly, strips, siteCCW),
  });
  const stripLabel = (arr) => (i) => `#${i + 1}「${arr[i].name}」`;

  const gaps = gapCells.map((g) => toRisk(g, 'gap')).sort((a, b) => b.area - a.area);
  const triples = tripleCells.map((g) => toRisk(g, 'triple')).sort((a, b) => b.area - a.area);
  const bRisks = boundaryTriples.map((bt) => ({
    kind: 'triple-boundary',
    area: 0,
    length: bt.length,
    segment: [bt.a, bt.b],
    centroid: { x: (bt.a.x + bt.b.x) / 2, y: (bt.a.y + bt.b.y) / 2 },
    coverStrips: bt.owners.map(stripLabel(strips)),
    evidence: boundaryEdgeEvidence(bt, strips, siteCCW),
  }));
  const pRisks = pointTriples.map((pt) => ({
    kind: 'triple-point',
    area: 0,
    point: pt.point,
    centroid: pt.point,
    coverStrips: pt.owners.map(stripLabel(strips)),
    evidence: pointEvidence(pt, strips, siteCCW),
  }));

  // 首个风险：漏拍优先于三重曝光；面积大者优先；零面积边界段、点次之
  let firstRisk = null;
  if (gaps.length) firstRisk = gaps[0];
  else if (triples.length) firstRisk = triples[0];
  else if (bRisks.length) firstRisk = bRisks[0];
  else if (pRisks.length) firstRisk = pRisks[0];

  return {
    ok: true,
    status: firstRisk ? 'risk' : 'pass',
    errors: [],
    siteArea,
    totalCellArea,
    areaBalanceError: Math.abs(totalCellArea - siteArea),
    gapArea,
    tripleArea,
    gaps,
    triples,
    boundaryTriples: bRisks,
    pointTriples: pRisks,
    firstRisk,
    cells,
    site: siteCCW,
    strips,
  };
}

// ---------- 边界证据 ----------
// 单元的每条边必落在发掘区边界或某条覆盖带的边上（切分线全部来自带边）。
function edgeEvidence(poly, strips, site) {
  const ev = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i];
    const B = poly[(i + 1) % poly.length];
    let source = null;
    for (let k = 0; k < site.length && !source; k++) {
      if (segmentsCoincide(A, B, site[k], site[(k + 1) % site.length])) {
        source = `发掘区边界 V${k + 1}(${fmt(site[k])})→V${k + 2}(${fmt(site[(k + 1) % site.length])})`;
      }
    }
    for (let ri = 0; ri < strips.length && !source; ri++) {
      for (let k = 0; k < 4; k++) {
        if (segmentsCoincide(A, B, strips[ri].poly[k], strips[ri].poly[(k + 1) % 4])) {
          source = `覆盖带 #${ri + 1}「${strips[ri].name}」的第 ${k + 1} 条边（该带角度 ${strips[ri].angle}°）`;
          break;
        }
      }
    }
    ev.push({
      from: A,
      to: B,
      length: dist(A, B),
      source: source || '内部切割边',
    });
  }
  return ev;
}

function boundaryEdgeEvidence(bt, strips, site) {
  const ev = [
    {
      type: 'line-overlap',
      from: bt.a,
      to: bt.b,
      length: bt.length,
      source: `三条覆盖带边界在发掘区内共线重叠，重叠段长 ${bt.length.toFixed(4)} m，参与带：${
        bt.owners.map((i) => `#${i + 1}「${strips[i].name}」`).join('、')}`,
    },
  ];
  // 线段端点若贴合发掘区边界，补充证据
  [bt.a, bt.b].forEach((p) => {
    for (let k = 0; k < site.length; k++) {
      const A = site[k], B = site[(k + 1) % site.length];
      if (Math.abs(cross(A, B, p)) <= 1e-6 &&
          Math.min(A.x, B.x) - 1e-6 <= p.x && p.x <= Math.max(A.x, B.x) + 1e-6) {
        ev.push({ type: 'site-touch', point: p, source: `端点位于发掘区边界 V${k + 1}→V${k + 2}` });
      }
    }
  });
  return ev;
}

function pointEvidence(pt, strips, site) {
  const reasons = [];
  pt.owners.forEach((ri) => {
    const r = strips[ri];
    const onEdges = [];
    for (let k = 0; k < 4; k++) {
      const A = r.poly[k], B = r.poly[(k + 1) % 4];
      if (Math.abs(cross(A, B, pt.point)) <= 1e-6 &&
          Math.min(A.x, B.x) - 1e-6 <= pt.point.x && pt.point.x <= Math.max(A.x, B.x) + 1e-6) {
        onEdges.push(k + 1);
      }
    }
    reasons.push(
      `#${ri + 1}「${r.name}」` +
      (onEdges.length ? `（接触于第 ${onEdges.join('、')} 条边，边界接触计入覆盖）` : '（该点位于带内）')
    );
  });
  let siteNote = null;
  for (let k = 0; k < site.length; k++) {
    const A = site[k], B = site[(k + 1) % site.length];
    if (Math.abs(cross(A, B, pt.point)) <= 1e-6 &&
        Math.min(A.x, B.x) - 1e-6 <= pt.point.x && pt.point.x <= Math.max(A.x, B.x) + 1e-6) {
      siteNote = `该点同时位于发掘区边界 V${k + 1}→V${k + 2}`;
    }
  }
  return [
    { type: 'point-contact', point: pt.point, source: `${reasons.join('；')}，于 ${fmt(pt.point)} 处形成三重接触` },
    ...(siteNote ? [{ type: 'site-touch', point: pt.point, source: siteNote }] : []),
  ];
}

const fmt = (p) => `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`;

// ---------- 输入校验 ----------
function validateInput(site, strips) {
  const errors = [];
  if (!Array.isArray(site) || site.length < 3) {
    errors.push('工作区至少需要 3 个顶点');
  } else {
    const pts = site.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
      errors.push('工作区顶点坐标必须为数字');
    } else {
      if (Math.abs(signedArea(pts)) < EPS) errors.push('工作区多边形面积为 0');
      else if (!isConvex(pts)) errors.push('工作区必须是凸多边形（请按逆时针顺序录入顶点）');
    }
  }
  if (!Array.isArray(strips) || strips.length < 3 || strips.length > 12) {
    errors.push('覆盖带数量必须在 3 至 12 条之间');
  } else {
    strips.forEach((s, i) => {
      const w = Number(s.width), h = Number(s.height);
      const cx = Number(s.cx), cy = Number(s.cy);
      if (![w, h, cx, cy].every(Number.isFinite)) {
        errors.push(`覆盖带 #${i + 1} 中心或宽高非法`);
      } else if (!(w > 0 && h > 0)) {
        errors.push(`覆盖带 #${i + 1} 宽高必须为正数`);
      }
      if (![cx, cy, w, h].every(Number.isInteger)) {
        errors.push(`覆盖带 #${i + 1} 中心坐标与宽高必须为整数`);
      }
      if (s.angle === undefined || s.angle === null || s.angle === '') {
        // 角度缺省按 0 处理
      } else if (!Number.isFinite(Number(s.angle))) {
        errors.push(`覆盖带 #${i + 1} 角度非法`);
      } else if (!Number.isInteger(Number(s.angle))) {
        errors.push(`覆盖带 #${i + 1} 角度必须为整数（度）`);
      }
    });
  }
  return errors;
}

function isConvex(ptsIn) {
  const pts = signedArea(ptsIn) < 0 ? [...ptsIn].reverse() : ptsIn;
  for (let i = 0; i < pts.length; i++) {
    if (cross(pts[i], pts[(i + 1) % pts.length], pts[(i + 2) % pts.length]) < -1e-7) return false;
  }
  return true;
}


// ===== 内联模块：app.mjs =====
// app.mjs —— 前端交互：草稿录入、报告即时撤销、平面图与明细渲染


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

})();
