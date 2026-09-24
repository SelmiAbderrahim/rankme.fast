---
title: "自行托管 RankMeFast"
description: "使用 Docker Compose 在自己的服务器上运行 RankMeFast。"
locale: zh
slug: self-hosting
section: start
order: 5
---

# 自行托管 RankMeFast

## 开始之前

安装 Docker 和 Compose，并获取项目源代码。在项目目录中执行以下命令。软件免费，服务器和提供商 API 用量由你付费。请勿公开环境配置文件。

## 配置安装

复制模板，然后编辑根目录的 `.env`：

```bash
cp .env.example .env
```

设置部署所需的 `CLIENT_URL` 和 `SERVER_URL`。`BETTER_AUTH_SECRET` 和 `MASTER_ENCRYPTION_KEY` 各需要一个独立的随机值，请分别运行一次 `openssl rand -hex 32`。然后按照 `.env.example` 配置真实提供商、凭据和邮件服务。自用部署可以保留 `PAYMENT_PROVIDER=none`。

如果部署在同一个源上，请将 `APP_URL` 和 `VITE_SITE_URL` 设为与 `CLIENT_URL` 相同的值。

不要使用占位凭据启动。生产环境默认拒绝模拟提供商，公开部署中不要启用演示例外。

## 启动并检查

完成配置后启动平台，并确认所有服务都处于健康状态：

```bash
docker compose up -d --build
docker compose ps
```

然后打开 `CLIENT_URL` 指定的地址，创建账户并添加第一个网站。

## 维护运行

服务器安全、HTTPS、更新，以及数据库和环境文件的备份都由你负责。每次更新前请先备份。启动失败时检查服务日志，不要公开包含凭据的日志。
