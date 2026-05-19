# 🚀 GitHub Pages 部署指南

## 📋 部署步骤

### 1️⃣ 推送到GitHub仓库

```bash
# 推送所有提交到远程仓库
git push origin main
```

### 2️⃣ 配置GitHub Pages

1. 打开你的GitHub仓库页面
2. 点击 **Settings** (设置)
3. 在左侧菜单找到 **Pages**
4. 在 **Source** 部分：
   - 选择 **GitHub Actions** 作为部署源
   - 系统会自动识别 `.github/workflows/deploy.yml` 文件

### 3️⃣ 等待自动部署

- 推送代码后，GitHub Actions 会自动触发部署
- 你可以在 **Actions** 标签页查看部署进度
- 首次部署可能需要 2-3 分钟

### 4️⃣ 访问你的网站

部署成功后，你的网站将通过以下URL访问：
```
https://<你的GitHub用户名>.github.io/<仓库名称>/
```

例如：
```
https://username.github.io/peace-tasks/
```

## 🔧 自动部署配置

项目已配置自动部署工作流：

- **触发条件**：
  - 推送到 `main` 分支
  - 手动触发（workflow_dispatch）

- **部署流程**：
  1. 检出代码
  2. 配置Pages环境
  3. 上传项目文件
  4. 部署到GitHub Pages

## 📝 注意事项

### ⚠️ 安全提醒

1. **不要提交敏感信息**
   - `config.js` 中的 GitHub Token 已经硬编码
   - 生产环境建议使用环境变量
   - 考虑使用 GitHub Secrets 存储敏感配置

2. **LocalStorage数据**
   - 用户数据存储在浏览器LocalStorage
   - 每个域名有独立的存储空间
   - 清除浏览器数据会丢失所有本地记录

### 🔐 认证系统

- 用户注册登录数据存储在浏览器LocalStorage
- 不同用户的数据完全隔离
- 密码使用哈希算法加密存储

### 🌐 自定义域名（可选）

如果你想使用自定义域名：

1. 在仓库根目录创建 `CNAME` 文件
2. 添加你的域名，例如：`tasks.example.com`
3. 在域名DNS设置中添加CNAME记录

## 🛠️ 故障排除

### 部署失败？

1. 检查 **Actions** 标签页的日志
2. 确认 `.github/workflows/deploy.yml` 文件存在
3. 验证所有文件都在 `main` 分支

### 网站无法访问？

1. 等待几分钟，部署可能需要时间
2. 检查GitHub Pages设置是否正确
3. 清除浏览器缓存后重试

### 功能异常？

1. 打开浏览器开发者工具（F12）
2. 查看Console是否有错误
3. 检查Network请求是否正常

## 📊 项目结构

```
peace-tasks/
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Pages部署配置
├── css/
│   └── style.css           # 样式文件
├── js/
│   ├── auth.js             # 用户认证模块
│   ├── app.js              # 核心逻辑
│   ├── config.js           # 配置文件
│   └── tasks.js            # 任务池
├── index.html              # 主页面
├── .gitignore              # Git忽略文件
└── DEPLOY.md               # 部署文档（本文件）
```

## 🎉 完成！

现在你的和平精英趣味任务管理系统已经可以通过互联网访问了！

分享链接给你的朋友，大家一起愉快的玩游戏吧！🎮
