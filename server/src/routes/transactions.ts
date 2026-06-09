import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  getUserTransactions,
  getAllTransactions,
  getUserBalance,
} from '../services/transactionService';

const router = express.Router();

router.get('/my', authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.pageSize as string, 10) || 50;
    const result = await getUserTransactions(req.user.userId, page, pageSize);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取交易记录失败' });
  }
});

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.pageSize as string, 10) || 50;
    const result = await getAllTransactions(page, pageSize);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取交易记录失败' });
  }
});

router.get('/balance', authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const balance = await getUserBalance(req.user.userId);
    res.json({ balance });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取余额失败' });
  }
});

router.get('/user/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.pageSize as string, 10) || 50;
    const result = await getUserTransactions(req.params.userId, page, pageSize);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取用户交易记录失败' });
  }
});

export default router;
