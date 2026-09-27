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

export const EPS = 1e-9;

// ---------- 基础工具 ----------

export const cross = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export const polygonArea = (pts) => Math.abs(signedArea(pts));

export function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function popcount(n) {
  let c = 0;
  while (n) { n &= n - 1; c++; }
  return c;
}

// 凸多边形面积重心（风险区域标识点）
export function centroid(pts) {
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
export function rectVertices(cx, cy, w, h, angleDeg) {
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
export function tessellate(site, strips) {
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
export function pointInConvex(P, poly, tol = -EPS) {
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
export function boundaryTripleOverlaps(site, strips) {
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
export function triplePointContacts(site, strips, areaTriples, boundaryTriples) {
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
export function buildStrips(inputs) {
  return inputs.map((s) => ({
    ...s,
    angle: Number(s.angle) || 0,
    poly: rectVertices(Number(s.cx), Number(s.cy), Number(s.width), Number(s.height), Number(s.angle) || 0),
  }));
}

export function certify(siteInput, stripInputs) {
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
export function edgeEvidence(poly, strips, site) {
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
export function validateInput(site, strips) {
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
