import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { login, getUserById, getAllUsers, rechargeBalance, createUser } from '../services/authService';
import { logAudit } from '../services/auditService';

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    const result = await login(username, password);
    await logAudit(
      { userId: result.user.id, username: result.user.username, role: result.user.role },
      'login',
      null,
      '用户登录',
      req.ip
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '登录失败' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const user = await getUserById(req.user.userId);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取用户信息失败' });
  }
});

router.get('/users', authenticate, requireRole('admin'), async (_req, res) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取用户列表失败' });
  }
});

router.post('/users', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const { username, password, name, role, initialBalance } = req.body;
    const user = await createUser({
      username,
      password,
      name,
      role,
      initialBalance,
      createdBy: req.user.userId,
    });
    await logAudit(req.user, 'create_user', null, `创建用户: ${username}`, req.ip);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '创建用户失败' });
  }
});

router.post('/users/:id/recharge', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const { id } = req.params;
    const { amount } = req.body;
    const user = await rechargeBalance(id, amount, req.user.userId);
    await logAudit(req.user, 'recharge', null, `给用户 ${user.name} 充值 ${amount} 元`, req.ip);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '充值失败' });
  }
});

export default router;
