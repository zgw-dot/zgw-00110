import { v4 as uuidv4 } from 'uuid';
import db from '../database';
import { Booking, ForbiddenError, JWTPayload, RescheduleRequest, RescheduleRequestWithDetails, RescheduleStatus, Venue } from '../types';
import { checkTimeOverlap } from './bookingService';
import { addBookingHistory } from './auditService';

export interface CreateRescheduleParams {
  bookingId: string;
  newDate: string;
  newStartTime: string;
  newEndTime: string;
  reason: string;
  user: JWTPayload;
}

export interface HandleRescheduleParams {
  rescheduleId: string;
  rejectionReason?: string;
  user: JWTPayload;
}

export interface WithdrawRescheduleParams {
  rescheduleId: string;
  withdrawReason?: string;
  user: JWTPayload;
}

function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export async function validateTimeRange(startTime: string, endTime: string): Promise<void> {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  
  if (endMinutes <= startMinutes) {
    throw new Error('结束时间必须晚于开始时间');
  }
}

export async function createReschedule(params: CreateRescheduleParams): Promise<RescheduleRequestWithDetails> {
  const { bookingId, newDate, newStartTime, newEndTime, reason, user } = params;

  await validateTimeRange(newStartTime, newEndTime);

  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]) as Booking | undefined;
  if (!booking) {
    throw new Error('预约不存在');
  }

  if (booking.user_id !== user.userId) {
    throw new ForbiddenError('只能对自己的预约发起改期');
  }

  if (booking.status !== 'pending' && booking.status !== 'approved') {
    throw new Error('只能对待审批或已通过的预约发起改期');
  }

  const pendingReschedule = await db.get(`
    SELECT * FROM reschedule_requests 
    WHERE booking_id = ? AND status = 'pending'
  `, [bookingId]);
  if (pendingReschedule) {
    throw new Error('该预约已有待处理的改期申请');
  }

  const venue = await db.get('SELECT * FROM venues WHERE id = ? AND is_active = 1', [booking.venue_id]) as Venue | undefined;
  if (!venue) {
    throw new Error('场地不存在或已停用');
  }

  if (await checkTimeOverlap(booking.venue_id, newDate, newStartTime, newEndTime, bookingId)) {
    throw new Error('该时段已被占用');
  }

  const rescheduleId = uuidv4();

  await db.run(`
    INSERT INTO reschedule_requests (
      id, booking_id, user_id,
      old_date, old_start_time, old_end_time,
      new_date, new_start_time, new_end_time,
      reason, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `, [
    rescheduleId, bookingId, user.userId,
    booking.date, booking.start_time, booking.end_time,
    newDate, newStartTime, newEndTime,
    reason
  ]);

  return await db.get(`
    SELECT r.*, v.name as venue_name, v.code as venue_code, u.name as user_name, u.username as user_username
    FROM reschedule_requests r
    LEFT JOIN bookings b ON r.booking_id = b.id
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.id = ?
  `, [rescheduleId]) as RescheduleRequestWithDetails;
}

export async function approveReschedule(params: HandleRescheduleParams): Promise<RescheduleRequestWithDetails> {
  const { rescheduleId, user } = params;

  const reschedule = await db.get('SELECT * FROM reschedule_requests WHERE id = ?', [rescheduleId]) as RescheduleRequest | undefined;
  if (!reschedule) {
    throw new Error('改期申请不存在');
  }

  if (reschedule.status !== 'pending') {
    throw new Error('该改期申请已被处理');
  }

  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [reschedule.booking_id]) as Booking | undefined;
  if (!booking) {
    throw new Error('预约不存在');
  }

  if (booking.status !== 'pending' && booking.status !== 'approved') {
    throw new Error('预约状态不允许改期');
  }

  const venue = await db.get('SELECT * FROM venues WHERE id = ? AND is_active = 1', [booking.venue_id]) as Venue | undefined;
  if (!venue) {
    throw new Error('场地不存在或已停用');
  }

  if (await checkTimeOverlap(booking.venue_id, reschedule.new_date, reschedule.new_start_time, reschedule.new_end_time, booking.id)) {
    throw new Error('该时段已被占用');
  }

  await db.runTransaction(async () => {
    await db.run(`
      UPDATE bookings
      SET date = ?, start_time = ?, end_time = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [reschedule.new_date, reschedule.new_start_time, reschedule.new_end_time, reschedule.booking_id]);

    await db.run(`
      UPDATE reschedule_requests
      SET status = 'approved', handled_by = ?, handled_by_name = ?, handled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [user.userId, user.username, rescheduleId]);

    await addBookingHistory(
      reschedule.booking_id,
      booking.status,
      booking.status,
      user.userId,
      user.username,
      `改期通过: ${reschedule.old_date} ${reschedule.old_start_time}-${reschedule.old_end_time} → ${reschedule.new_date} ${reschedule.new_start_time}-${reschedule.new_end_time}`
    );
  });

  return await db.get(`
    SELECT r.*, v.name as venue_name, v.code as venue_code, u.name as user_name, u.username as user_username
    FROM reschedule_requests r
    LEFT JOIN bookings b ON r.booking_id = b.id
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.id = ?
  `, [rescheduleId]) as RescheduleRequestWithDetails;
}

export async function rejectReschedule(params: HandleRescheduleParams): Promise<RescheduleRequestWithDetails> {
  const { rescheduleId, rejectionReason, user } = params;

  const reschedule = await db.get('SELECT * FROM reschedule_requests WHERE id = ?', [rescheduleId]) as RescheduleRequest | undefined;
  if (!reschedule) {
    throw new Error('改期申请不存在');
  }

  if (reschedule.status !== 'pending') {
    throw new Error('该改期申请已被处理');
  }

  await db.run(`
    UPDATE reschedule_requests
    SET status = 'rejected', handled_by = ?, handled_by_name = ?, handled_at = CURRENT_TIMESTAMP, 
        rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [user.userId, user.username, rejectionReason || '管理员拒绝', rescheduleId]);

  return await db.get(`
    SELECT r.*, v.name as venue_name, v.code as venue_code, u.name as user_name, u.username as user_username
    FROM reschedule_requests r
    LEFT JOIN bookings b ON r.booking_id = b.id
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.id = ?
  `, [rescheduleId]) as RescheduleRequestWithDetails;
}

export async function withdrawReschedule(params: WithdrawRescheduleParams): Promise<RescheduleRequestWithDetails> {
  const { rescheduleId, withdrawReason, user } = params;

  const reschedule = await db.get('SELECT * FROM reschedule_requests WHERE id = ?', [rescheduleId]) as RescheduleRequest | undefined;
  if (!reschedule) {
    throw new Error('改期申请不存在');
  }

  if (reschedule.user_id !== user.userId) {
    throw new ForbiddenError('只能撤回自己的改期申请');
  }

  if (reschedule.status === 'withdrawn') {
    throw new Error('该改期申请已被撤回，请勿重复操作');
  }

  if (reschedule.status === 'approved') {
    throw new Error('该改期申请已通过审批，无法撤回');
  }

  if (reschedule.status === 'rejected') {
    throw new Error('该改期申请已被拒绝，无法撤回');
  }

  if (reschedule.status !== 'pending') {
    throw new Error('该改期申请已被处理，无法撤回');
  }

  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [reschedule.booking_id]) as Booking | undefined;
  if (!booking) {
    throw new Error('关联预约不存在');
  }

  await db.runTransaction(async () => {
    await db.run(`
      UPDATE reschedule_requests
      SET status = 'withdrawn', handled_by = ?, handled_by_name = ?, handled_at = CURRENT_TIMESTAMP,
          withdraw_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [user.userId, user.username, withdrawReason || '用户撤回', rescheduleId]);

    await addBookingHistory(
      reschedule.booking_id,
      booking.status,
      booking.status,
      user.userId,
      user.username,
      `撤回改期申请: ${reschedule.old_date} ${reschedule.old_start_time}-${reschedule.old_end_time} → ${reschedule.new_date} ${reschedule.new_start_time}-${reschedule.new_end_time}，撤回原因: ${withdrawReason || '用户撤回'}`
    );
  });

  return await db.get(`
    SELECT r.*, v.name as venue_name, v.code as venue_code, u.name as user_name, u.username as user_username
    FROM reschedule_requests r
    LEFT JOIN bookings b ON r.booking_id = b.id
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.id = ?
  `, [rescheduleId]) as RescheduleRequestWithDetails;
}

export async function getRescheduleRequests(filters: {
  userId?: string;
  bookingId?: string;
  status?: RescheduleStatus;
  page?: number;
  pageSize?: number;
}) {
  const { userId, bookingId, status, page = 1, pageSize = 20 } = filters;
  const offset = (page - 1) * pageSize;

  const whereClauses: string[] = [];
  const params: any[] = [];

  if (userId) {
    whereClauses.push('r.user_id = ?');
    params.push(userId);
  }
  if (bookingId) {
    whereClauses.push('r.booking_id = ?');
    params.push(bookingId);
  }
  if (status) {
    whereClauses.push('r.status = ?');
    params.push(status);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const requests = await db.all(`
    SELECT r.*, v.name as venue_name, v.code as venue_code, u.name as user_name, u.username as user_username
    FROM reschedule_requests r
    LEFT JOIN bookings b ON r.booking_id = b.id
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON r.user_id = u.id
    ${whereSql}
    ORDER BY r.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, pageSize, offset]);

  const total = await db.get(`
    SELECT COUNT(*) as count FROM reschedule_requests r
    ${whereSql}
  `, params) as { count: number };

  return {
    requests,
    total: total.count,
    page,
    pageSize,
  };
}

export async function getRescheduleById(rescheduleId: string): Promise<RescheduleRequestWithDetails | undefined> {
  return await db.get(`
    SELECT r.*, v.name as venue_name, v.code as venue_code, u.name as user_name, u.username as user_username
    FROM reschedule_requests r
    LEFT JOIN bookings b ON r.booking_id = b.id
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.id = ?
  `, [rescheduleId]) as RescheduleRequestWithDetails | undefined;
}

export async function getPendingRescheduleCount(): Promise<{ pending: number }> {
  const result = await db.get("SELECT COUNT(*) as count FROM reschedule_requests WHERE status = 'pending'") as { count: number };
  return { pending: result.count };
}
