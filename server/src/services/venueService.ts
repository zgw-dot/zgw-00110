import { v4 as uuidv4 } from 'uuid';
import db from '../database';
import { Venue } from '../types';

export interface CreateVenueParams {
  code: string;
  name: string;
  description?: string;
  capacity: number;
  depositAmount: number;
}

export interface UpdateVenueParams {
  name?: string;
  description?: string;
  capacity?: number;
  depositAmount?: number;
  isActive?: number;
}

export async function createVenue(params: CreateVenueParams): Promise<Venue> {
  const existing = await db.get('SELECT id FROM venues WHERE code = ?', [params.code]);
  if (existing) {
    throw new Error(`场地编号 ${params.code} 已存在`);
  }

  const id = uuidv4();
  await db.run(`
    INSERT INTO venues (id, code, name, description, capacity, deposit_amount, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `, [id, params.code, params.name, params.description || '', params.capacity, params.depositAmount]);

  return await db.get('SELECT * FROM venues WHERE id = ?', [id]) as Venue;
}

export async function updateVenue(id: string, params: UpdateVenueParams): Promise<Venue> {
  const venue = await db.get('SELECT * FROM venues WHERE id = ?', [id]) as Venue | undefined;
  if (!venue) {
    throw new Error('场地不存在');
  }

  const fields: string[] = [];
  const values: any[] = [];

  if (params.name !== undefined) {
    fields.push('name = ?');
    values.push(params.name);
  }
  if (params.description !== undefined) {
    fields.push('description = ?');
    values.push(params.description);
  }
  if (params.capacity !== undefined) {
    fields.push('capacity = ?');
    values.push(params.capacity);
  }
  if (params.depositAmount !== undefined) {
    fields.push('deposit_amount = ?');
    values.push(params.depositAmount);
  }
  if (params.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(params.isActive);
  }

  if (fields.length > 0) {
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    await db.run(`UPDATE venues SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  return await db.get('SELECT * FROM venues WHERE id = ?', [id]) as Venue;
}

export async function getVenueById(id: string): Promise<Venue | undefined> {
  return await db.get('SELECT * FROM venues WHERE id = ?', [id]) as Venue | undefined;
}

export async function getVenueByCode(code: string): Promise<Venue | undefined> {
  return await db.get('SELECT * FROM venues WHERE code = ?', [code]) as Venue | undefined;
}

export async function getAllVenues(includeInactive: boolean = false): Promise<Venue[]> {
  if (includeInactive) {
    return await db.all('SELECT * FROM venues ORDER BY code') as Venue[];
  }
  return await db.all("SELECT * FROM venues WHERE is_active = 1 ORDER BY code") as Venue[];
}

export async function deleteVenue(id: string): Promise<void> {
  const hasBookings = await db.get('SELECT COUNT(*) as count FROM bookings WHERE venue_id = ?', [id]) as { count: number };
  if (hasBookings.count > 0) {
    throw new Error('该场地存在预约记录，无法删除，请先停用');
  }
  await db.run('DELETE FROM venues WHERE id = ?', [id]);
}

export interface VenueImportResult {
  success: number;
  failed: number;
  errors: { row: number; code: string; error: string }[];
  duplicates: string[];
}

export async function importVenues(venues: CreateVenueParams[]): Promise<VenueImportResult> {
  const result: VenueImportResult = {
    success: 0,
    failed: 0,
    errors: [],
    duplicates: [],
  };

  const seenCodes = new Set<string>();
  const existingVenues = await db.all('SELECT code FROM venues');
  const existingCodes = new Set(existingVenues.map((v: any) => v.code));

  for (let index = 0; index < venues.length; index++) {
    const venue = venues[index];
    const rowNum = index + 1;
    try {
      if (!venue.code || !venue.name) {
        throw new Error('编号和名称不能为空');
      }
      if (venue.capacity < 0) {
        throw new Error('容量不能为负数');
      }
      if (venue.depositAmount < 0) {
        throw new Error('押金不能为负数');
      }
      if (seenCodes.has(venue.code)) {
        result.duplicates.push(venue.code);
        throw new Error('CSV内重复编号');
      }
      if (existingCodes.has(venue.code)) {
        result.duplicates.push(venue.code);
        throw new Error('系统中已存在该编号');
      }

      seenCodes.add(venue.code);
      await createVenue(venue);
      result.success++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        row: rowNum,
        code: venue.code || '',
        error: err instanceof Error ? err.message : '未知错误',
      });
    }
  }

  return result;
}
