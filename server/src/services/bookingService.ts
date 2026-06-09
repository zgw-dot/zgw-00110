import { v4 as uuidv4 } from 'uuid';
import db from '../database';
import { Booking, BookingStatus, JWTPayload, Venue, User } from '../types';
import { createTransaction, reverseTransaction } from './transactionService';
import { addBookingHistory } from './auditService';

const STATUS_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  rejected: [],
  no_show: [],
};

export async function checkTimeOverlap(
  venueId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeBookingId?: string
): Promise<boolean> {
  const excludeClause = excludeBookingId ? 'AND id != ?' : '';
  const params = excludeBookingId
    ? [venueId, date, endTime, startTime, excludeBookingId]
    : [venueId, date, endTime, startTime];

  const overlapping = await db.get(`
    SELECT COUNT(*) as count FROM bookings
    WHERE venue_id = ? AND date = ?
      AND status IN ('pending', 'approved', 'checked_in')
      AND start_time < ? AND end_time > ?
      ${excludeClause}
  `, params) as { count: number };

  return overlapping.count > 0;
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) || false;
}

export interface CreateBookingParams {
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  purpose: string;
  userId: string;
  user: JWTPayload;
}

export async function createBooking(params: CreateBookingParams): Promise<Booking> {
  const { venueId, date, startTime, endTime, purpose, userId, user } = params;

  const venue = await db.get('SELECT * FROM venues WHERE id = ? AND is_active = 1', [venueId]) as Venue | undefined;
  if (!venue) {
    throw new Error('场地不存在或已停用');
  }

  if (await checkTimeOverlap(venueId, date, startTime, endTime)) {
    throw new Error('该时段已被预约');
  }

  const resident = await db.get('SELECT * FROM users WHERE id = ?', [userId]) as User | undefined;
  if (!resident) {
    throw new Error('用户不存在');
  }

  const bookingId = uuidv4();

  await db.runTransaction(async () => {
    const lockedUser = await db.get('SELECT * FROM users WHERE id = ?', [userId]) as User | undefined;
    if (!lockedUser) {
      throw new Error('用户不存在');
    }
    if (lockedUser.balance < venue.deposit_amount) {
      throw new Error('余额不足，无法冻结押金');
    }

    await db.run(`
      INSERT INTO bookings (
        id, venue_id, user_id, date, start_time, end_time, purpose,
        status, deposit_amount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `, [bookingId, venueId, userId, date, startTime, endTime, purpose, venue.deposit_amount]);

    const depositTx = await createTransaction({
      userId,
      bookingId,
      type: 'deposit_freeze',
      amount: venue.deposit_amount,
      description: `预约场地【${venue.name}】冻结押金 ${date} ${startTime}-${endTime}`,
      createdBy: user.userId,
    });

    await db.run('UPDATE bookings SET deposit_transaction_id = ? WHERE id = ?', [depositTx.id, bookingId]);

    await addBookingHistory(bookingId, null, 'pending', user.userId, user.username, '提交预约申请');
  });

  return await db.get(`
    SELECT b.*, v.name as venue_name, v.code as venue_code, u.name as user_name
    FROM bookings b
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON b.user_id = u.id
    WHERE b.id = ?
  `, [bookingId]) as Booking;
}

export interface ApproveBookingParams {
  bookingId: string;
  user: JWTPayload;
}

export async function approveBooking(params: ApproveBookingParams): Promise<Booking> {
  const { bookingId, user } = params;

  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]) as Booking | undefined;
  if (!booking) {
    throw new Error('预约不存在');
  }

  await db.runTransaction(async () => {
    const lockedBooking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]) as Booking | undefined;
    if (!lockedBooking) {
      throw new Error('预约不存在');
    }

    if (!canTransition(lockedBooking.status, 'approved')) {
      throw new Error(`无法从${lockedBooking.status}状态审批通过`);
    }

    if (await checkTimeOverlap(lockedBooking.venue_id, lockedBooking.date, lockedBooking.start_time, lockedBooking.end_time, bookingId)) {
      throw new Error('该时段已被其他预约占用');
    }

    await db.run(`
      UPDATE bookings
      SET status = 'approved', approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [user.userId, bookingId]);

    await addBookingHistory(bookingId, booking.status, 'approved', user.userId, user.username, '管理员审批通过');
  });

  return await db.get(`
    SELECT b.*, v.name as venue_name, v.code as venue_code, u.name as user_name
    FROM bookings b
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON b.user_id = u.id
    WHERE b.id = ?
  `, [bookingId]) as Booking;
}

export interface RejectBookingParams {
  bookingId: string;
  reason: string;
  user: JWTPayload;
}

export async function rejectBooking(params: RejectBookingParams): Promise<Booking> {
  const { bookingId, reason, user } = params;

  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]) as Booking | undefined;
  if (!booking) {
    throw new Error('预约不存在');
  }

  await db.runTransaction(async () => {
    const lockedBooking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]) as Booking | undefined;
    if (!lockedBooking) {
      throw new Error('预约不存在');
    }

    if (!canTransition(lockedBooking.status, 'rejected')) {
      throw new Error(`无法从${lockedBooking.status}状态拒绝`);
    }

    if (lockedBooking.deposit_transaction_id) {
      await reverseTransaction(lockedBooking.deposit_transaction_id, user.userId);
    }

    await db.run(`
      UPDATE bookings
      SET status = 'rejected', rejected_by = ?, rejection_reason = ?,
          refund_transaction_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [user.userId, reason, null, bookingId]);

    await addBookingHistory(bookingId, lockedBooking.status, 'rejected', user.userId, user.username, reason || '管理员拒绝');
  });

  return await db.get(`
    SELECT b.*, v.name as venue_name, v.code as venue_code, u.name as user_name
    FROM bookings b
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON b.user_id = u.id
    WHERE b.id = ?
  `, [bookingId]) as Booking;
}

export interface CheckInParams {
  bookingId: string;
  user: JWTPayload;
}

export async function checkIn(params: CheckInParams): Promise<Booking> {
  const { bookingId, user } = params;

  await db.runTransaction(async () => {
    const lockedBooking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]) as Booking | undefined;
    if (!lockedBooking) {
      throw new Error('预约不存在');
    }

    if (!canTransition(lockedBooking.status, 'checked_in')) {
      throw new Error(`无法从${lockedBooking.status}状态签到`);
    }

    await db.run(`
      UPDATE bookings
      SET status = 'checked_in', checked_in_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [bookingId]);

    await addBookingHistory(bookingId, lockedBooking.status, 'checked_in', user.userId, user.username, '完成签到');
  });

  return await db.get(`
    SELECT b.*, v.name as venue_name, v.code as venue_code, u.name as user_name
    FROM bookings b
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON b.user_id = u.id
    WHERE b.id = ?
  `, [bookingId]) as Booking;
}

export interface CompleteBookingParams {
  bookingId: string;
  user: JWTPayload;
}

export async function completeBooking(params: CompleteBookingParams): Promise<Booking> {
  const { bookingId, user } = params;

  await db.runTransaction(async () => {
    const lockedBooking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]) as Booking | undefined;
    if (!lockedBooking) {
      throw new Error('预约不存在');
    }

    if (!canTransition(lockedBooking.status, 'completed')) {
      throw new Error(`无法从${lockedBooking.status}状态完成核销`);
    }

    if (lockedBooking.deposit_transaction_id) {
      const refundTx = await createTransaction({
        userId: lockedBooking.user_id,
        bookingId,
        type: 'deposit_refund',
        amount: lockedBooking.deposit_amount,
        description: '场地使用完成，退还押金',
        createdBy: user.userId,
      });

      await db.run('UPDATE bookings SET refund_transaction_id = ? WHERE id = ?', [refundTx.id, bookingId]);
    }

    await db.run(`
      UPDATE bookings
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [bookingId]);

    await addBookingHistory(bookingId, lockedBooking.status, 'completed', user.userId, user.username, '完成使用，核销押金');
  });

  return await db.get(`
    SELECT b.*, v.name as venue_name, v.code as venue_code, u.name as user_name
    FROM bookings b
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON b.user_id = u.id
    WHERE b.id = ?
  `, [bookingId]) as Booking;
}

export interface CancelBookingParams {
  bookingId: string;
  reason: string;
  user: JWTPayload;
}

export async function cancelBooking(params: CancelBookingParams): Promise<Booking> {
  const { bookingId, reason, user } = params;

  await db.runTransaction(async () => {
    const lockedBooking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]) as Booking | undefined;
    if (!lockedBooking) {
      throw new Error('预约不存在');
    }

    if (!canTransition(lockedBooking.status, 'cancelled')) {
      throw new Error(`无法从${lockedBooking.status}状态取消`);
    }

    if (user.role === 'resident' && lockedBooking.user_id !== user.userId) {
      throw new Error('只能取消自己的预约');
    }

    if (lockedBooking.deposit_transaction_id && lockedBooking.status !== 'completed') {
      const refundTx = await createTransaction({
        userId: lockedBooking.user_id,
        bookingId,
        type: 'deposit_refund',
        amount: lockedBooking.deposit_amount,
        description: `取消预约，退还押金：${reason}`,
        createdBy: user.userId,
      });

      await db.run('UPDATE bookings SET refund_transaction_id = ? WHERE id = ?', [refundTx.id, bookingId]);
    }

    await db.run(`
      UPDATE bookings
      SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [bookingId]);

    await addBookingHistory(bookingId, lockedBooking.status, 'cancelled', user.userId, user.username, reason || '取消预约');
  });

  return await db.get(`
    SELECT b.*, v.name as venue_name, v.code as venue_code, u.name as user_name
    FROM bookings b
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON b.user_id = u.id
    WHERE b.id = ?
  `, [bookingId]) as Booking;
}

export interface MarkNoShowParams {
  bookingId: string;
  user: JWTPayload;
}

export async function markNoShow(params: MarkNoShowParams): Promise<Booking> {
  const { bookingId, user } = params;

  await db.runTransaction(async () => {
    const lockedBooking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]) as Booking | undefined;
    if (!lockedBooking) {
      throw new Error('预约不存在');
    }

    if (!canTransition(lockedBooking.status, 'no_show')) {
      throw new Error(`无法从${lockedBooking.status}状态标记爽约`);
    }

    if (lockedBooking.deposit_transaction_id) {
      await createTransaction({
        userId: lockedBooking.user_id,
        bookingId,
        type: 'deposit_deduct',
        amount: lockedBooking.deposit_amount,
        description: '未到场爽约，扣除押金',
        createdBy: user.userId,
      });
    }

    await db.run(`
      UPDATE bookings
      SET status = 'no_show', no_show_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [bookingId]);

    await addBookingHistory(bookingId, lockedBooking.status, 'no_show', user.userId, user.username, '标记为爽约，押金扣除');
  });

  return await db.get(`
    SELECT b.*, v.name as venue_name, v.code as venue_code, u.name as user_name
    FROM bookings b
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON b.user_id = u.id
    WHERE b.id = ?
  `, [bookingId]) as Booking;
}

export async function getBookings(filters: {
  userId?: string;
  venueId?: string;
  status?: BookingStatus;
  date?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}) {
  const { userId, venueId, status, date, startDate, endDate, page = 1, pageSize = 20 } = filters;
  const offset = (page - 1) * pageSize;

  const whereClauses: string[] = [];
  const params: any[] = [];

  if (userId) {
    whereClauses.push('b.user_id = ?');
    params.push(userId);
  }
  if (venueId) {
    whereClauses.push('b.venue_id = ?');
    params.push(venueId);
  }
  if (status) {
    whereClauses.push('b.status = ?');
    params.push(status);
  }
  if (date) {
    whereClauses.push('b.date = ?');
    params.push(date);
  }
  if (startDate) {
    whereClauses.push('b.date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    whereClauses.push('b.date <= ?');
    params.push(endDate);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const bookings = await db.all(`
    SELECT b.*, v.name as venue_name, v.code as venue_code, u.name as user_name
    FROM bookings b
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON b.user_id = u.id
    ${whereSql}
    ORDER BY b.date DESC, b.start_time DESC
    LIMIT ? OFFSET ?
  `, [...params, pageSize, offset]);

  const total = await db.get(`
    SELECT COUNT(*) as count FROM bookings b
    ${whereSql}
  `, params) as { count: number };

  return {
    bookings,
    total: total.count,
    page,
    pageSize,
  };
}

export async function getBookingById(bookingId: string) {
  return await db.get(`
    SELECT b.*, v.name as venue_name, v.code as venue_code, u.name as user_name, u.username as user_username
    FROM bookings b
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON b.user_id = u.id
    WHERE b.id = ?
  `, [bookingId]);
}

export async function getCalendarBookings(venueId: string, startDate: string, endDate: string) {
  return await db.all(`
    SELECT b.*, v.name as venue_name, v.code as venue_code, u.name as user_name
    FROM bookings b
    LEFT JOIN venues v ON b.venue_id = v.id
    LEFT JOIN users u ON b.user_id = u.id
    WHERE b.venue_id = ? AND b.date >= ? AND b.date <= ?
      AND b.status IN ('pending', 'approved', 'checked_in')
    ORDER BY b.date, b.start_time
  `, [venueId, startDate, endDate]);
}

export async function getPendingCount() {
  const pending = await db.get("SELECT COUNT(*) as count FROM bookings WHERE status = 'pending'") as { count: number };
  const approved = await db.get("SELECT COUNT(*) as count FROM bookings WHERE status = 'approved'") as { count: number };
  const checkedIn = await db.get("SELECT COUNT(*) as count FROM bookings WHERE status = 'checked_in'") as { count: number };

  return {
    pending: pending.count,
    approved: approved.count,
    checkedIn: checkedIn.count,
  };
}
