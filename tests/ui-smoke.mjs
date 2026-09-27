// ui-smoke.mjs —— 轻量 DOM 垫片下驱动真实前端产物，验证交互链路无运行时错误
// （无浏览器环境时的前端冒烟；不替代浏览器，只执行全部渲染/事件代码路径）
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

class ClassList {
  constructor(node) { this.node = node; }
  add(c) { const s = new Set(this.node.className.split(/\s+/).filter(Boolean)); s.add(c); this.node.className = [...s].join(' '); }
  remove(c) { this.node.className = this.node.className.split(/\s+/).filter((x) => x !== c).join(' '); }
  contains(c) { return this.node.className.split(/\s+/).includes(c); }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this._ls = {};
    this._innerHTML = '';
    this._text = '';
    this.value = '';
    this.checked = false;
    this.className = '';
    this.title = '';
    this.type = '';
    this.classList = new ClassList(this);
  }
  set innerHTML(v) { this._innerHTML = v; this.children = []; this._text = ''; }
  get innerHTML() { return this.children.length ? this._innerHTML : (this._text || this._innerHTML); }
  set textContent(v) { this._text = String(v); this.children = []; this._innerHTML = ''; }
  get textContent() { return this._text; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
  appendChild(n) { this.children.push(n); n.parentNode = this; return n; }
  addEventListener(t, fn) { (this._ls[t] ||= []).push(fn); }
  dispatch(t, ev = {}) { (this._ls[t] || []).forEach((fn) => fn({ target: this, ...ev })); }
  click() { this.dispatch('click'); }
}

const ids = new Map();
const byId = (id) => {
  if (!ids.has(id)) ids.set(id, new El('div'));
  return ids.get(id);
};
// 选择器结果持久化（监听器挂接与后续操作必须指向同一节点）
const selReg = new Map();
const tbody = new El('tbody');
selReg.set('#stripTable tbody', [tbody]);
const presetButtons = ['pass', 'gap', 'triple'].map((p) => {
  const b = new El('button'); b.dataset.preset = p; return b;
});
selReg.set('.presets button', presetButtons);

globalThis.document = {
  getElementById: byId,
  createElement: (tag) => new El(tag),
  createElementNS: (_ns, tag) => new El(tag),
  querySelector: (sel) => {
    if (!selReg.has(sel)) selReg.set(sel, [new El('div')]);
    return selReg.get(sel)[0];
  },
  querySelectorAll: (sel) => selReg.get(sel) || [],
};

await import(pathToFileURL(path.resolve('public/app.bundle.js')).href);

// 1) 初始草稿为 gap：发起认证 → 风险结论，且有首个风险描述
byId('certifyBtn').dispatch('click');
assert.match(byId('verdict').innerHTML, /认证不通过/);
assert.match(byId('verdict').innerHTML, /漏拍/);
assert.ok(byId('plan').children.length > 0, '平面图应有绘制内容');
assert.ok(tbody.children.length === 3, '明细应列出 3 条带');

// 2) 切换合格预设 → 重新认证通过
selReg.get('.presets button').find((b) => b.dataset.preset === 'pass').click();
assert.ok(!byId('revokeNote').classList.contains('hidden') === false);
byId('certifyBtn').click();
assert.match(byId('verdict').innerHTML, /认证通过/, byId('verdict').innerHTML);

// 3) 增加一条带 → 草稿变更立即撤销旧报告
byId('addStrip').click();
assert.ok(!byId('revokeNote').classList.contains('hidden'), '草稿变更后必须显示撤销提示');
assert.match(byId('verdict').innerHTML, /尚未认证/);

// 4) 4 条带的草稿仍可正常认证
byId('certifyBtn').click();
assert.ok(byId('verdict').className.includes('pass') || byId('verdict').className.includes('risk'));

// 5) 三重曝光预设
selReg.get('.presets button').find((b) => b.dataset.preset === 'triple').click();
byId('certifyBtn').click();
assert.match(byId('verdict').innerHTML, /三重曝光/);
assert.match(byId('verdict').innerHTML, /面积/);
assert.ok(byId('risks').children.length >= 1, '至少一张风险卡');
assert.ok([...byId('risks').children].some((c) => c.innerHTML.includes('首个风险')), '应标注首个风险');

// 6) 切换切分单元显示不应报错
byId('meshToggle').checked = true;
byId('meshToggle').dispatch('change');
assert.ok(byId('plan').children.length > 0);

// 7) 删除工作区顶点 / 覆盖带行不报错
const beforeStrips = byId('stripRows').children.length;
byId('stripRows').children.at(-1).children.at(-1).click();
assert.equal(byId('stripRows').children.length, beforeStrips - 1);
byId('addSiteVertex').click();
const beforeVerts = byId('siteRows').children.length;
byId('siteRows').children.at(-1).children.at(-1).click();
assert.equal(byId('siteRows').children.length, beforeVerts - 1);

// 8) 非法输入（非凸 + 只有 2 条带）给出 invalid 结论而非抛异常
byId('siteRows'); // noop
// 直接通过 certify 按钮路径：把行数删到 2 条
while (byId('stripRows').children.length > 2) {
  byId('stripRows').children.at(-1).children.at(-1).click();
}
byId('certifyBtn').click();
assert.ok(byId('verdict').className.includes('invalid'));

console.log('✔ 前端交互冒烟通过：预设载入、报告即时撤销、认证渲染、明细、风险卡片与平面图均正常');
