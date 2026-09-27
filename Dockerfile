# syntax=docker/dockerfile:1

# ---------- 验证阶段：单元测试 + 前端构建 + 业务冒烟（一次性服务 verify 使用） ----------
FROM node:22-alpine AS verify
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts
# npm run verify = 几何单元测试 → 静态构建（含语法校验）→ 合格/风险业务冒烟 → 前端交互冒烟
# 任一步失败则进程以非零退出码退出
CMD ["npm", "run", "verify"]

# ---------- 构建阶段：生成纯静态产物 ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ---------- web 服务阶段：nginx 托管静态前端 ----------
FROM nginx:1.27-alpine AS web
COPY --from=builder /app/public /usr/share/nginx/html
COPY docker/nginx-default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
