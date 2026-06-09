import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { getAuditLogs } from '../services/auditService';

const router = express.Router();

router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.pageSize as string, 10) || 50;
    const result = await getAuditLogs(page, pageSize);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取审计日志失败' });
  }
});

export default router;
