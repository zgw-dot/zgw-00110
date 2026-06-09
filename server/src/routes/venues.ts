import express from 'express';
import fs from 'fs';
import path from 'path';
import { authenticate, requireRole } from '../middleware/auth';
import {
  createVenue,
  updateVenue,
  getVenueById,
  getAllVenues,
  deleteVenue,
  importVenues,
  CreateVenueParams,
} from '../services/venueService';
import { logAudit } from '../services/auditService';
import { parseVenuesCsv, exportVenuesCsv } from '../services/csvService';

const router = express.Router();

router.get('/', authenticate, async (_req, res) => {
  try {
    const venues = await getAllVenues();
    res.json(venues);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取场地列表失败' });
  }
});

router.get('/all', authenticate, requireRole('admin'), async (_req, res) => {
  try {
    const venues = await getAllVenues(true);
    res.json(venues);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取场地列表失败' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const venue = await getVenueById(req.params.id);
    if (!venue) {
      return res.status(404).json({ error: '场地不存在' });
    }
    res.json(venue);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取场地信息失败' });
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const { code, name, description, capacity, depositAmount } = req.body;
    const venue = await createVenue({ code, name, description, capacity, depositAmount });
    await logAudit(req.user, 'create_venue', null, `创建场地: ${code} - ${name}`, req.ip);
    res.json(venue);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '创建场地失败' });
  }
});

router.put('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const venue = await updateVenue(req.params.id, req.body);
    await logAudit(req.user, 'update_venue', null, `更新场地: ${venue.code}`, req.ip);
    res.json(venue);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '更新场地失败' });
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const venue = await getVenueById(req.params.id);
    if (!venue) {
      return res.status(404).json({ error: '场地不存在' });
    }
    await deleteVenue(req.params.id);
    await logAudit(req.user, 'delete_venue', null, `删除场地: ${venue.code} - ${venue.name}`, req.ip);
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '删除场地失败' });
  }
});

router.post('/import', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const { csvContent } = req.body;
    if (!csvContent) {
      return res.status(400).json({ error: 'CSV内容不能为空' });
    }
    const venues = await parseVenuesCsv(csvContent);
    const result = await importVenues(venues);
    await logAudit(
      req.user,
      'import_venues',
      null,
      `导入场地: 成功${result.success}条, 失败${result.failed}条, 重复${result.duplicates.length}条`,
      req.ip
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '导入失败' });
  }
});

router.get('/export/csv', authenticate, requireRole('admin'), async (_req, res) => {
  try {
    const venues = await getAllVenues(true);
    const exportDir = path.join(__dirname, '..', '..', 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    const filePath = path.join(exportDir, `venues_${Date.now()}.csv`);
    await exportVenuesCsv(venues, filePath);
    res.download(filePath, `venues_${Date.now()}.csv`, (err) => {
      if (err) {
        res.status(500).json({ error: '导出失败' });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '导出失败' });
  }
});

export default router;
