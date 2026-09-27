// smoke.mjs —— 向覆盖认证业务模块（src/geometry.mjs）提交合格与风险场景的冒烟测试
// 退出码：全部符合预期 → 0；任一不符 → 1
import { certify } from '../src/geometry.mjs';

const square = [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];
const S = (name, cx, cy, width, height, angle = 0) => ({ name, cx, cy, width, height, angle });

const scenarios = [
  {
    title: '合格场景：三条带边界相接即完整覆盖（边界接触计入）',
    site: square,
    strips: [
      S('带1-下段', 50, 17, 100, 34),
      S('带2-中段', 50, 51, 100, 34),
      S('带3-上段', 50, 85, 100, 34),
    ],
    expect: (r) =>
      r.status === 'pass' &&
      r.gapArea === 0 && r.tripleArea === 0 &&
      r.boundaryTriples.length === 0 && r.pointTriples.length === 0,
  },
  {
    title: '风险场景-漏拍：旋转画幅之间的狭长未拍区',
    site: square,
    strips: [
      S('S1', 50, 15, 100, 30),
      S('S2', 50, 50, 100, 30),
      S('S3', 50, 85, 100, 30),
    ],
    expect: (r) =>
      r.status === 'risk' &&
      r.firstRisk.kind === 'gap' &&
      Math.abs(r.firstRisk.area - 500) < 1e-6 &&
      r.firstRisk.evidence.length >= 4 &&
      r.firstRisk.evidence.some((e) => e.source.includes('发掘区边界')) &&
      r.firstRisk.evidence.some((e) => e.source.includes('覆盖带')),
  },
  {
    title: '风险场景-三重曝光：中央 20m 宽条带被三条带重复覆盖',
    site: square,
    strips: [
      S('A', 50, 30, 100, 60),
      S('B', 50, 70, 100, 60),
      S('C', 50, 50, 100, 60),
    ],
    expect: (r) =>
      r.status === 'risk' &&
      r.firstRisk.kind === 'triple' &&
      Math.abs(r.firstRisk.area - 2000) < 1e-6 &&
      r.firstRisk.multiplicity === 3,
  },
  {
    title: '风险场景-零面积三重边界接触（边界也算三重曝光）',
    site: square,
    strips: [
      S('A', 50, 17, 100, 34),
      S('B', 50, 50, 100, 32),
      S('C', 50, 67, 100, 66),
    ],
    expect: (r) =>
      r.status === 'risk' &&
      r.firstRisk.kind === 'triple-boundary' &&
      r.firstRisk.area === 0 &&
      Math.abs(r.firstRisk.length - 100) < 1e-5,
  },
  {
    title: '风险场景-三重点接触',
    site: square,
    strips: [
      S('左半', 25, 50, 50, 100),
      S('右下', 75, 25, 50, 50),
      S('右上', 75, 75, 50, 50),
    ],
    expect: (r) =>
      r.status === 'risk' && r.firstRisk.kind === 'triple-point',
  },
  {
    title: '非法草稿：非凸工作区被拒绝',
    site: [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 50 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ],
    strips: [S('a', 10, 10, 20, 20), S('b', 30, 30, 20, 20), S('c', 50, 50, 20, 20)],
    expect: (r) => r.status === 'invalid' && r.errors.some((e) => e.includes('凸')),
  },
];

let failures = 0;
console.log('===== 覆盖认证业务模块 · 冒烟测试 =====');
for (const sc of scenarios) {
  const r = certify(sc.site, sc.strips);
  const pass = sc.expect(r);
  console.log(
    `${pass ? '✔' : '✘'} ${sc.title}\n` +
    `   → status=${r.status}` +
    (r.firstRisk ? `，首个风险=${r.firstRisk.kind}，面积=${r.firstRisk.area ?? '-'}` : '') +
    (r.errors && r.errors.length ? `，校验=${r.errors.join('；')}` : ''),
  );
  if (!pass) {
    failures++;
    console.log('   实际结果：', JSON.stringify({
      status: r.status,
      firstRisk: r.firstRisk && { kind: r.firstRisk.kind, area: r.firstRisk.area, length: r.firstRisk.length },
      gapArea: r.gapArea, tripleArea: r.tripleArea,
    }));
  }
}
console.log('======================================');
if (failures) {
  console.error(`冒烟失败：${failures}/${scenarios.length} 个场景不符合预期`);
  process.exit(1);
}
console.log(`冒烟通过：${scenarios.length}/${scenarios.length} 个场景全部符合预期`);
