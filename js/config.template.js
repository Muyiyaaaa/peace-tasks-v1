/**
 * 配置文件模板 - 复制为 config.js 后修改
 * 使用步骤：
 * 1. 复制本文件为 config.js
 * 2. 在 GitHub 创建 Secret Gist，文件名 peace_task.json，内容 {}
 * 3. 记下 Gist ID（URL 最后一段）
 * 4. 在 GitHub Settings > Developer settings > Personal access tokens 生成 Token
 * 5. Token 需要 gist 权限
 * 6. 将 Gist ID 和 Token 填入下方
 */
const CONFIG = {
  gist: {
    id: '你的Gist_ID',           // ← 替换为你的 Gist ID
    token: '你的GitHub_PAT',     // ← 替换为你的 PAT Token
    file: 'peace_task.json'
  },
  game: {
    maxPlayers: 4,               // 最大玩家数
    lockDuration: 5 * 60 * 1000, // 5分钟锁定时长
    pollInterval: 5000            // 轮询间隔
  }
};
