/**
 * 用户认证模块 - 邮箱密码注册登录
 */
(function() {
  'use strict';

  const AUTH_STORAGE_PREFIX = 'pea_auth_';
  const USER_DATA_PREFIX = 'pea_user_';

  // 当前登录用户
  let currentUser = null;

  // 密码加密（简单哈希，生产环境应使用bcrypt等）
  function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  // 验证邮箱格式
  function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  // 获取所有用户
  function getAllUsers() {
    const users = localStorage.getItem(AUTH_STORAGE_PREFIX + 'users');
    return users ? JSON.parse(users) : {};
  }

  // 保存所有用户
  function saveAllUsers(users) {
    localStorage.setItem(AUTH_STORAGE_PREFIX + 'users', JSON.stringify(users));
  }

  // 注册用户
  function register(email, password, username) {
    if (!isValidEmail(email)) {
      return { success: false, message: '邮箱格式不正确' };
    }

    if (password.length < 6) {
      return { success: false, message: '密码长度至少6位' };
    }

    if (!username || username.trim().length === 0) {
      return { success: false, message: '用户名不能为空' };
    }

    if (username.length > 7) {
      return { success: false, message: '用户名最多7个字符' };
    }

    const users = getAllUsers();

    if (users[email]) {
      return { success: false, message: '该邮箱已注册' };
    }

    users[email] = {
      email: email,
      password: hashPassword(password),
      username: username.trim(),
      createdAt: Date.now()
    };

    saveAllUsers(users);

    // 初始化用户数据空间
    initUserData(email);

    return { success: true, message: '注册成功' };
  }

  // 登录用户
  function login(email, password) {
    const users = getAllUsers();
    const user = users[email];

    if (!user) {
      return { success: false, message: '邮箱或密码错误' };
    }

    if (user.password !== hashPassword(password)) {
      return { success: false, message: '邮箱或密码错误' };
    }

    // 设置当前用户
    currentUser = user;
    localStorage.setItem(AUTH_STORAGE_PREFIX + 'current', email);

    return { success: true, message: '登录成功', user: user };
  }

  // 登出
  function logout() {
    currentUser = null;
    localStorage.removeItem(AUTH_STORAGE_PREFIX + 'current');
  }

  // 获取当前用户
  function getCurrentUser() {
    if (currentUser) return currentUser;

    const email = localStorage.getItem(AUTH_STORAGE_PREFIX + 'current');
    if (!email) return null;

    const users = getAllUsers();
    const user = users[email];
    if (user) {
      currentUser = user;
      return user;
    }

    return null;
  }

  // 检查是否已登录
  function isLoggedIn() {
    return getCurrentUser() !== null;
  }

  // 初始化用户数据空间
  function initUserData(email) {
    const safeEmail = email.replace(/[@.]/g, '_');
    const userKey = USER_DATA_PREFIX + safeEmail;

    if (!localStorage.getItem(userKey)) {
      localStorage.setItem(userKey, JSON.stringify({
        myNum: null,
        userNames: {},
        favorites: [],
        history: [],
        customTasks: []
      }));
    }
  }

  // 获取用户专属数据
  function getUserData(key) {
    if (!currentUser) return null;

    const safeEmail = currentUser.email.replace(/[@.]/g, '_');
    const userKey = USER_DATA_PREFIX + safeEmail;
    const data = localStorage.getItem(userKey);

    if (!data) return null;

    const userData = JSON.parse(data);
    return userData[key];
  }

  // 设置用户专属数据
  function setUserData(key, value) {
    if (!currentUser) return false;

    const safeEmail = currentUser.email.replace(/[@.]/g, '_');
    const userKey = USER_DATA_PREFIX + safeEmail;
    let data = localStorage.getItem(userKey);
    let userData = data ? JSON.parse(data) : {};

    userData[key] = value;
    localStorage.setItem(userKey, JSON.stringify(userData));

    return true;
  }

  // 获取用户所有数据
  function getAllUserData() {
    if (!currentUser) return null;

    const safeEmail = currentUser.email.replace(/[@.]/g, '_');
    const userKey = USER_DATA_PREFIX + safeEmail;
    const data = localStorage.getItem(userKey);

    return data ? JSON.parse(data) : null;
  }

  // 修改密码
  function changePassword(oldPassword, newPassword) {
    if (!currentUser) return { success: false, message: '未登录' };

    if (newPassword.length < 6) {
      return { success: false, message: '新密码长度至少6位' };
    }

    const users = getAllUsers();
    const user = users[currentUser.email];

    if (user.password !== hashPassword(oldPassword)) {
      return { success: false, message: '原密码错误' };
    }

    user.password = hashPassword(newPassword);
    users[currentUser.email] = user;
    saveAllUsers(users);

    return { success: true, message: '密码修改成功' };
  }

  // 修改用户名
  function changeUsername(newUsername) {
    if (!currentUser) return { success: false, message: '未登录' };

    if (!newUsername || newUsername.trim().length === 0) {
      return { success: false, message: '用户名不能为空' };
    }

    if (newUsername.length > 7) {
      return { success: false, message: '用户名最多7个字符' };
    }

    const users = getAllUsers();
    const user = users[currentUser.email];

    user.username = newUsername.trim();
    users[currentUser.email] = user;
    saveAllUsers(users);

    currentUser = user;
    return { success: true, message: '用户名修改成功' };
  }

  // 导出API
  window.AuthAPI = {
    register,
    login,
    logout,
    getCurrentUser,
    isLoggedIn,
    getUserData,
    setUserData,
    getAllUserData,
    changePassword,
    changeUsername,
    isValidEmail
  };

})();
