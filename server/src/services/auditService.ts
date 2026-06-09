import { v4 as uuidv4 } from 'uuid';
import db from '../database';
import { JWTPayload } from '../types';

export async function logAudit(
  user: JWTPayload,
  action: string,
  bookingId: string | null,
  details: string,
  ipAddress: string = 'unknown'
) {
  await db.run(`
    INSERT INTO audit_logs (id, user_id, user_name, action, booking_id, details, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [uuidv4(), user.userId, user.username, action, bookingId, details, ipAddress]);
}

export async function getAuditLogs(page: number = 1, pageSize: number = 50) {
  const offset = (page - 1) * pageSize;
  const logs = await db.all(`
    SELECT al.*, u.name as user_display_name
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    ORDER BY al.created_at DESC
    LIMIT ? OFFSET ?
  `, [pageSize, offset]);

  const total = await db.get('SELECT COUNT(*) as count FROM audit_logs') as { count: number };

  return {
    logs,
    total: total.count,
    page,
    pageSize,
  };
}

export async function addBookingHistory(
  bookingId: string,
  statusFrom: string | null,
  statusTo: string,
  changedBy: string,
  changedByName: string,
  reason: string | null = null
) {
  await db.run(`
    INSERT INTO booking_histories (id, booking_id, status_from, status_to, changed_by, changed_by_name, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [uuidv4(), bookingId, statusFrom, statusTo, changedBy, changedByName, reason]);
}

export async function getBookingHistory(bookingId: string) {
  return await db.all(`
    SELECT * FROM booking_histories
    WHERE booking_id = ?
    ORDER BY created_at ASC
  `, [bookingId]);
}
