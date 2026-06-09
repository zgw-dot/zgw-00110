import express from 'express';
import fs from 'fs';
import path from 'path';
import { authenticate, requireRole } from '../middleware/auth';
import {
  createBooking,
  approveBooking,
  rejectBooking,
  checkIn,
  completeBooking,
  cancelBooking,
  markNoShow,
  getBookings,
  getBookingById,
  getCalendarBookings,
  getPendingCount,
  checkTimeOverlap,
} from '../services/bookingService';
import { logAudit, getBookingHistory } from '../services/auditService';
import { exportBookingsCsv } from '../services/csvService';
import {
  createReschedule,
  approveReschedule,
  rejectReschedule,
  getRescheduleRequests,
  getRescheduleById,
  getPendingRescheduleCount,
} from '../services/rescheduleService';
import { BookingStatus, ForbiddenError, RescheduleStatus } from '../types';

const router = express.Router();

router.get('/pending-count', authenticate, async (_req, res) => {
  try {
    const counts = await getPendingCount();
    const rescheduleCounts = await getPendingRescheduleCount();
    res.json({ ...counts, pendingReschedule: rescheduleCounts.pending });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取待处理数量失败' });
  }
});

router.get('/reschedules', authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });

    const filters: any = {};
    if (req.user.role === 'resident') {
      filters.userId = req.user.userId;
    }
    if (req.query.bookingId) filters.bookingId = req.query.bookingId as string;
    if (req.query.status) filters.status = req.query.status as RescheduleStatus;
    if (req.query.page) filters.page = parseInt(req.query.page as string, 10);
    if (req.query.pageSize) filters.pageSize = parseInt(req.query.pageSize as string, 10);
    if (req.query.userId && req.user.role === 'admin') {
      filters.userId = req.query.userId as string;
    }

    const result = await getRescheduleRequests(filters);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取改期列表失败' });
  }
});

router.get('/reschedules/:id', authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });

    const reschedule = await getRescheduleById(req.params.id);
    if (!reschedule) {
      return res.status(404).json({ error: '改期申请不存在' });
    }

    if (req.user.role === 'resident' && reschedule.user_id !== req.user.userId) {
      return res.status(403).json({ error: '无权查看此改期申请' });
    }

    res.json(reschedule);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取改期详情失败' });
  }
});

router.post('/:id/reschedule', authenticate, requireRole('resident'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const { newDate, newStartTime, newEndTime, reason } = req.body;
    
    if (!newDate || !newStartTime || !newEndTime || !reason) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    const reschedule = await createReschedule({
      bookingId: req.params.id,
      newDate,
      newStartTime,
      newEndTime,
      reason,
      user: req.user,
    });

    await logAudit(
      req.user,
      'reschedule_request',
      req.params.id,
      `申请改期: ${reschedule.old_date} ${reschedule.old_start_time}-${reschedule.old_end_time} → ${reschedule.new_date} ${reschedule.new_start_time}-${reschedule.new_end_time}, 原因: ${reason}`,
      req.ip
    );

    res.json(reschedule);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: err.message });
    } else {
      res.status(400).json({ error: err instanceof Error ? err.message : '改期申请失败' });
    }
  }
});

router.post('/reschedules/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });

    const reschedule = await approveReschedule({
      rescheduleId: req.params.id,
      user: req.user,
    });

    await logAudit(
      req.user,
      'reschedule_approve',
      reschedule.booking_id,
      `同意改期: ${reschedule.old_date} ${reschedule.old_start_time}-${reschedule.old_end_time} → ${reschedule.new_date} ${reschedule.new_start_time}-${reschedule.new_end_time}`,
      req.ip
    );

    res.json(reschedule);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '同意改期失败' });
  }
});

router.post('/reschedules/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const { reason } = req.body;

    const reschedule = await rejectReschedule({
      rescheduleId: req.params.id,
      rejectionReason: reason || '管理员拒绝',
      user: req.user,
    });

    await logAudit(
      req.user,
      'reschedule_reject',
      reschedule.booking_id,
      `拒绝改期: ${reschedule.old_date} ${reschedule.old_start_time}-${reschedule.old_end_time} → ${reschedule.new_date} ${reschedule.new_start_time}-${reschedule.new_end_time}, 原因: ${reason || '管理员拒绝'}`,
      req.ip
    );

    res.json(reschedule);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '拒绝改期失败' });
  }
});

router.get('/calendar', authenticate, async (req, res) => {
  try {
    const { venueId, startDate, endDate } = req.query;
    if (!venueId || !startDate || !endDate) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const bookings = await getCalendarBookings(
      venueId as string,
      startDate as string,
      endDate as string
    );
    res.json(bookings);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取日历预约失败' });
  }
});

router.get('/check-overlap', authenticate, async (req, res) => {
  try {
    const { venueId, date, startTime, endTime, excludeBookingId } = req.query;
    if (!venueId || !date || !startTime || !endTime) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const hasOverlap = await checkTimeOverlap(
      venueId as string,
      date as string,
      startTime as string,
      endTime as string,
      excludeBookingId as string
    );
    res.json({ hasOverlap });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '检查时间冲突失败' });
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });

    const filters: any = {};
    if (req.user.role === 'resident') {
      filters.userId = req.user.userId;
    }
    if (req.query.venueId) filters.venueId = req.query.venueId as string;
    if (req.query.status) filters.status = req.query.status as BookingStatus;
    if (req.query.date) filters.date = req.query.date as string;
    if (req.query.startDate) filters.startDate = req.query.startDate as string;
    if (req.query.endDate) filters.endDate = req.query.endDate as string;
    if (req.query.page) filters.page = parseInt(req.query.page as string, 10);
    if (req.query.pageSize) filters.pageSize = parseInt(req.query.pageSize as string, 10);
    if (req.query.userId && req.user.role === 'admin') {
      filters.userId = req.query.userId as string;
    }

    const result = await getBookings(filters);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取预约列表失败' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });

    const booking = await getBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: '预约不存在' });
    }

    if (req.user.role === 'resident' && (booking as any).user_id !== req.user.userId) {
      return res.status(403).json({ error: '无权查看此预约' });
    }

    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取预约详情失败' });
  }
});

router.get('/:id/history', authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });

    const booking = await getBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: '预约不存在' });
    }

    if (req.user.role === 'resident' && (booking as any).user_id !== req.user.userId) {
      return res.status(403).json({ error: '无权查看此预约' });
    }

    const history = await getBookingHistory(req.params.id);
    res.json(history);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '获取预约历史失败' });
  }
});

router.post('/', authenticate, requireRole('resident'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const { venueId, date, startTime, endTime, purpose } = req.body;
    const booking = await createBooking({
      venueId,
      date,
      startTime,
      endTime,
      purpose,
      userId: req.user.userId,
      user: req.user,
    });
    await logAudit(
      req.user,
      'create_booking',
      booking.id,
      `申请预约: ${(booking as any).venue_name} ${date} ${startTime}-${endTime}`,
      req.ip
    );
    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '创建预约失败' });
  }
});

router.post('/:id/approve', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const booking = await approveBooking({ bookingId: req.params.id, user: req.user });
    await logAudit(
      req.user,
      'approve_booking',
      booking.id,
      `审批通过预约: ${(booking as any).venue_name} ${booking.date}`,
      req.ip
    );
    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '审批失败' });
  }
});

router.post('/:id/reject', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const { reason } = req.body;
    const booking = await rejectBooking({
      bookingId: req.params.id,
      reason: reason || '管理员拒绝',
      user: req.user,
    });
    await logAudit(
      req.user,
      'reject_booking',
      booking.id,
      `拒绝预约: ${(booking as any).venue_name} ${booking.date}, 原因: ${reason}`,
      req.ip
    );
    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '拒绝失败' });
  }
});

router.post('/:id/checkin', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const booking = await checkIn({ bookingId: req.params.id, user: req.user });
    await logAudit(
      req.user,
      'checkin_booking',
      booking.id,
      `签到: ${(booking as any).venue_name} ${booking.date}`,
      req.ip
    );
    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '签到失败' });
  }
});

router.post('/:id/complete', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const booking = await completeBooking({ bookingId: req.params.id, user: req.user });
    await logAudit(
      req.user,
      'complete_booking',
      booking.id,
      `完成核销: ${(booking as any).venue_name} ${booking.date}`,
      req.ip
    );
    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '核销失败' });
  }
});

router.post('/:id/cancel', authenticate, async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const { reason } = req.body;
    const booking = await cancelBooking({
      bookingId: req.params.id,
      reason: reason || '用户取消',
      user: req.user,
    });
    await logAudit(
      req.user,
      'cancel_booking',
      booking.id,
      `取消预约: ${(booking as any).venue_name} ${booking.date}, 原因: ${reason}`,
      req.ip
    );
    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '取消失败' });
  }
});

router.post('/:id/no-show', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: '未认证' });
    const booking = await markNoShow({ bookingId: req.params.id, user: req.user });
    await logAudit(
      req.user,
      'noshow_booking',
      booking.id,
      `标记爽约: ${(booking as any).venue_name} ${booking.date}`,
      req.ip
    );
    res.json(booking);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '标记失败' });
  }
});

router.get('/export/csv', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const filters: any = {};
    if (req.query.venueId) filters.venueId = req.query.venueId as string;
    if (req.query.status) filters.status = req.query.status as BookingStatus;
    if (req.query.startDate) filters.startDate = req.query.startDate as string;
    if (req.query.endDate) filters.endDate = req.query.endDate as string;
    filters.pageSize = 10000;

    const result = await getBookings(filters);

    const exportDir = path.join(__dirname, '..', '..', 'exports');
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    const filePath = path.join(exportDir, `bookings_${Date.now()}.csv`);
    await exportBookingsCsv(result.bookings, filePath);
    res.download(filePath, `bookings_${Date.now()}.csv`, (err) => {
      if (err) {
        res.status(500).json({ error: '导出失败' });
      }
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '导出失败' });
  }
});

export default router;
