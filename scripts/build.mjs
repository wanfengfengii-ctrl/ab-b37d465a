// build.mjs —— 零依赖静态构建：
// 1) 将 src 下的本地 ESM 模块按依赖顺序内联为单个 public/app.bundle.js
// 2) 拷贝 index.html / styles.css 到 public
// 3) 用 node --check 对产物做语法校验
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '..', 'src');
const OUT = path.join(here, '..', 'public');

const readModules = async (entry) => {
  const order = [];
  const seen = new Set();
  const visit = async (file) => {
    const abs = (await fs.realpath(file));
    if (seen.has(abs)) return;
    seen.add(abs);
    let code = await fs.readFile(abs, 'utf8');
    const importRe = /import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"];?/g;
    const deps = [];
    code = code.replace(importRe, (_m, names, spec) => {
      if (spec.startsWith('.')) {
        deps.push(path.resolve(path.dirname(abs), spec));
        return ''; // 本地模块全部内联，移除 import
      }
      return _m;    // 外部包保留（本项目无外部依赖）
    });
    for (const d of deps) await visit(d);
    order.push({ file: abs, code });
  };
  await visit(entry);
  return order;
};

const stripExports = (code) =>
  code
    .replace(/^export\s+function\s+/gm, 'function ')
    .replace(/^export\s+const\s+/gm, 'const ')
    .replace(/^export\s+class\s+/gm, 'class ');

const bundle = async () => {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const modules = await readModules(path.join(SRC, 'app.mjs'));
  const parts = modules.map((m) => {
    const rel = path.relative(SRC, m.file);
    return `// ===== 内联模块：${rel} =====\n${stripExports(m.code)}`;
  });
  const out = `// 自动生成，请勿编辑。由 scripts/build.mjs 内联 src/ 下模块构建。\n(function () {\n'use strict';\n\n${parts.join('\n\n')}\n})();\n`;
  await fs.writeFile(path.join(OUT, 'app.bundle.js'), out, 'utf8');

  for (const f of ['index.html', 'styles.css']) {
    await fs.copyFile(path.join(SRC, f), path.join(OUT, f));
  }

  // 语法校验（浏览器 DOM API 不在此执行，仅检查语法）
  execFileSync(process.execPath, ['--check', path.join(OUT, 'app.bundle.js')], { stdio: 'inherit' });
  console.log(`构建完成：${path.relative(process.cwd(), OUT)}/（${modules.length} 个模块已内联）`);
  void pathToFileURL;
};

bundle().catch((e) => {
  console.error('构建失败：', e);
  process.exit(1);
});
