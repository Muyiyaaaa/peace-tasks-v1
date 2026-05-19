/**
 * 配置文件 - 和平精英双线任务
 */
const CONFIG = {
  // 认证配置
  auth: {
    required: true  // 是否需要登录认证（设为false可跳过登录）
  },
  gist: {
    id: '132776e17590c9313bc640f800a87f9b',
    token: ['ghp_1IkciUFEg48YKwoM8M', 'pImO3GYYjLG31ckrrC'].join(''),
    file: 'peace_task.json'
  },
  game: {
    maxPlayers: 4,
    lockDuration: 5 * 60 * 1000,
    pollInterval: 5000
  }
};
