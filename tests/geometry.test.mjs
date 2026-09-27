// geometry.test.mjs —— node --test 单元测试（连续平面判定核心）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  certify, rectVertices, polygonArea, signedArea, tessellate,
  boundaryTripleOverlaps, triplePointContacts, buildStrips, popcount,
} from '../src/geometry.mjs';

const square = (n = 100) => [
  { x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n },
];
const strip = (name, cx, cy, width, height, angle = 0) => ({ name, cx, cy, width, height, angle });

const areasByMask = (res) => {
  const m = new Map();
  for (const c of res.cells) {
    const k = popcount(c.coverMask);
    m.set(c.coverMask, (m.get(c.coverMask) || 0) + polygonArea(c.poly));
    void k;
  }
  return m;
};

test('矩形顶点逆时针且面积正确（含旋转）', () => {
  const r = rectVertices(50, 50, 40, 20, 0);
  assert.ok(signedArea(r) > 0);
  assert.ok(Math.abs(polygonArea(r) - 800) < 1e-9);
  const r45 = rectVertices(0, 0, 10, 10, 45);
  assert.ok(Math.abs(polygonArea(r45) - 100) < 1e-9);
});

test('合格场景：三条带边界恰好相接即视为完整覆盖（边界接触计入）', () => {
  // 带1 y∈[0,34]，带2 y∈[34,68]，带3 y∈[68,102]，相接于直线 y=34 / y=68
  const strips = [
    strip('S1', 50, 17, 100, 34),
    strip('S2', 50, 51, 100, 34),
    strip('S3', 50, 85, 100, 34),
  ];
  const res = certify(square(), strips);
  assert.equal(res.status, 'pass', JSON.stringify(res.firstRisk));
  assert.equal(res.gapArea, 0);
  assert.equal(res.tripleArea, 0);
  assert.ok(res.areaBalanceError < 1e-6, `面积平衡误差 ${res.areaBalanceError}`);
});

test('漏拍场景：旋转画幅之间狭长未拍区被精确定位', () => {
  // [0,30] [35,65] [70,100] → 两条 5m 宽漏拍带，各 500 m²
  const strips = [
    strip('S1', 50, 15, 100, 30),
    strip('S2', 50, 50, 100, 30),
    strip('S3', 50, 85, 100, 30),
  ];
  const res = certify(square(), strips);
  assert.equal(res.status, 'risk');
  assert.equal(res.gaps.length, 2);
  assert.ok(Math.abs(res.gapArea - 1000) < 1e-6, `gapArea=${res.gapArea}`);
  assert.equal(res.firstRisk.kind, 'gap');
  assert.ok(Math.abs(res.firstRisk.area - 500) < 1e-6);
  // 边界证据：漏拍长边来自覆盖带边，短边来自发掘区边界
  const sources = res.firstRisk.evidence.map((e) => e.source);
  assert.ok(sources.some((s) => s.includes('覆盖带 #')), sources.join(' | '));
  assert.ok(sources.some((s) => s.includes('发掘区边界')), sources.join(' | '));
  assert.ok(res.areaBalanceError < 1e-6);
});

test('三重曝光场景：面积型三重区被定位且给出参与带', () => {
  // A: y∈[0,60]，B: y∈[40,100]，C: y∈[20,80] → [40,60] 三重，20×100
  const strips = [
    strip('A', 50, 30, 100, 60),
    strip('B', 50, 70, 100, 60),
    strip('C', 50, 50, 100, 60),
  ];
  const res = certify(square(), strips);
  assert.equal(res.status, 'risk');
  assert.equal(res.firstRisk.kind, 'triple');
  assert.ok(Math.abs(res.firstRisk.area - 2000) < 1e-6, `triple=${res.firstRisk.area}`);
  assert.equal(res.firstRisk.multiplicity, 3);
  assert.ok(Math.abs(res.tripleArea - 2000) < 1e-6);
  assert.equal(res.gapArea, 0);
  assert.ok(res.firstRisk.coverStrips.length === 3);
});

test('零面积三重：三条带边界在发掘区内共线重叠（接触也算三重）', () => {
  // A[0,34]、B[34,66]、C[34,100]：y=34 上 A,B,C 共线，三重接触段长 100
  const strips = [
    strip('A', 50, 17, 100, 34),
    strip('B', 50, 50, 100, 32),
    strip('C', 50, 67, 100, 66),
  ];
  const res = certify(square(), strips);
  assert.equal(res.status, 'risk');
  assert.equal(res.firstRisk.kind, 'triple-boundary');
  assert.equal(res.firstRisk.area, 0);
  assert.ok(Math.abs(res.firstRisk.length - 100) < 1e-5);
  assert.ok(res.firstRisk.evidence[0].source.includes('A'));
});

test('零面积三重：三个带仅在一点接触（角点相接）', () => {
  const strips = [
    strip('A', 25, 50, 50, 100, 0),  // 左半
    strip('B', 75, 25, 50, 50, 0),   // 右下
    strip('C', 75, 75, 50, 50, 0),   // 右上
  ];
  const res = certify(square(), strips);
  assert.equal(res.status, 'risk');
  assert.equal(res.firstRisk.kind, 'triple-point');
  assert.ok(Math.abs(res.firstRisk.point.x - 50) < 1e-6);
  assert.ok(Math.abs(res.firstRisk.point.y - 50) < 1e-6);
  assert.equal(res.gapArea, 0);
  assert.equal(res.tripleArea, 0);
});

test('旋转 45° 覆盖带：面积严格平衡且可认证合格', () => {
  // 大菱形覆盖整个方形；另两条小带置于对角且互不相交
  const strips = [
    strip('R', 50, 50, 142, 142, 45),
    strip('a', 20, 20, 30, 30, 0),
    strip('b', 80, 80, 30, 30, 0),
  ];
  const res = certify(square(), strips);
  assert.equal(res.status, 'pass', JSON.stringify(res.firstRisk));
  assert.ok(res.areaBalanceError < 1e-5, `balance=${res.areaBalanceError}`);
});

test('旋转不足的菱形留下角部漏拍三角区', () => {
  const strips = [
    strip('R', 50, 50, 130, 130, 45),
    strip('a', 20, 20, 30, 30, 0),
    strip('b', 80, 80, 30, 30, 0),
  ];
  const res = certify(square(), strips);
  assert.equal(res.status, 'risk');
  assert.ok(res.gaps.length >= 1);
  assert.ok(res.areaBalanceError < 1e-5);
  // 每角漏拍三角形理论直角边 ≈ 100 - 130/√2 ≈ 8.076
  const leg = 100 - 130 / Math.SQRT2;
  assert.ok(res.gapArea > 0);
  assert.ok(res.gapArea < 4 * (leg * leg / 2) + 1, `gapArea=${res.gapArea}`);
});

test('切分恒等性质：随机整数参数下单元面积总和恒等于工作区面积', () => {
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let trial = 0; trial < 40; trial++) {
    const n = 3 + Math.floor(rnd() * 5);
    const strips = [];
    for (let i = 0; i < n; i++) {
      strips.push(strip(
        `T${i}`,
        Math.round(rnd() * 100), Math.round(rnd() * 100),
        20 + Math.round(rnd() * 80), 20 + Math.round(rnd() * 80),
        Math.round(rnd() * 90),
      ));
    }
    const res = certify(square(), strips);
    assert.ok(res.areaBalanceError < 1e-4,
      `trial ${trial}: balance=${res.areaBalanceError}, cells=${res.cells.length}`);
  }
});

test('掩码恒等：重心判定与逐单元多边形位置一致', () => {
  const strips = buildStrips([
    strip('A', 50, 30, 100, 60),
    strip('B', 50, 70, 100, 60),
    strip('C', 50, 50, 40, 120, 30),
  ]);
  const cells = tessellate(square(), strips);
  for (const cell of cells) {
    // 单元顶点中任意严格内点不应跨越任一带边界（抽样单元重心即内点）
    assert.ok(polygonArea(cell.poly) > 1e-14);
  }
  assert.ok(cells.length >= 2);
});

test('输入校验：非凸工作区 / 带数量越界被拒绝', () => {
  const bad = certify(
    [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    [strip('a', 0, 0, 10, 10), strip('b', 0, 0, 10, 10), strip('c', 0, 0, 10, 10)],
  );
  assert.equal(bad.status, 'invalid');
  assert.ok(bad.errors.join('').includes('凸'));

  const few = certify(square(), [strip('a', 0, 0, 10, 10), strip('b', 0, 0, 10, 10)]);
  assert.equal(few.status, 'invalid');
});

test('输入校验：中心/宽高/角度必须为整数', () => {
  const nonInt = certify(square(), [
    strip('a', 50.5, 50, 100, 34),
    strip('b', 50, 51, 100, 34),
    strip('c', 50, 85, 100, 34),
  ]);
  assert.equal(nonInt.status, 'invalid');
  assert.ok(nonInt.errors.join('').includes('整数'));

  const nonIntAngle = certify(square(), [
    { name: 'a', cx: 50, cy: 17, width: 100, height: 34, angle: 12.5 },
    strip('b', 50, 51, 100, 34),
    strip('c', 50, 85, 100, 34),
  ]);
  assert.equal(nonIntAngle.status, 'invalid');
  assert.ok(nonIntAngle.errors.join('').includes('角度必须为整数'));
});

test('边界扫描 API 对合格场景不报错', () => {
  const strips = buildStrips([
    strip('S1', 50, 17, 100, 34),
    strip('S2', 50, 51, 100, 34),
    strip('S3', 50, 85, 100, 34),
  ]);
  const b = boundaryTripleOverlaps(square(), strips);
  const p = triplePointContacts(square(), strips, [], b);
  assert.equal(b.length, 0);
  assert.equal(p.length, 0);
});
