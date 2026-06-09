import csvParser from 'csv-parser';
import { createObjectCsvWriter } from 'csv-writer';
import { Readable } from 'stream';
import { CreateVenueParams } from './venueService';
import { Booking, BookingStatus } from '../types';

export interface ImportVenueRow {
  code: string;
  name: string;
  description?: string;
  capacity: string;
  deposit_amount: string;
}

export function parseVenuesCsv(fileContent: string): Promise<CreateVenueParams[]> {
  return new Promise((resolve, reject) => {
    const results: CreateVenueParams[] = [];
    const stream = Readable.from(fileContent);

    stream
      .pipe(csvParser())
      .on('data', (data: ImportVenueRow) => {
        results.push({
          code: (data.code || '').trim(),
          name: (data.name || '').trim(),
          description: (data.description || '').trim(),
          capacity: parseInt(data.capacity || '0', 10),
          depositAmount: parseFloat(data.deposit_amount || '0'),
        });
      })
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

export async function exportVenuesCsv(venues: any[], filePath: string): Promise<void> {
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'code', title: 'code' },
      { id: 'name', title: 'name' },
      { id: 'description', title: 'description' },
      { id: 'capacity', title: 'capacity' },
      { id: 'deposit_amount', title: 'deposit_amount' },
      { id: 'is_active', title: 'is_active' },
    ],
  });

  const records = venues.map(v => ({
    code: v.code,
    name: v.name,
    description: v.description || '',
    capacity: v.capacity,
    deposit_amount: v.deposit_amount,
    is_active: v.is_active,
  }));

  await csvWriter.writeRecords(records);
}

export interface ExportBookingRow {
  id: string;
  venue_code: string;
  venue_name: string;
  user_name: string;
  date: string;
  start_time: string;
  end_time: string;
  purpose: string;
  status: string;
  deposit_amount: number;
  created_at: string;
}

export async function exportBookingsCsv(bookings: any[], filePath: string): Promise<void> {
  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'id', title: 'id' },
      { id: 'venue_code', title: 'venue_code' },
      { id: 'venue_name', title: 'venue_name' },
      { id: 'user_name', title: 'user_name' },
      { id: 'date', title: 'date' },
      { id: 'start_time', title: 'start_time' },
      { id: 'end_time', title: 'end_time' },
      { id: 'purpose', title: 'purpose' },
      { id: 'status', title: 'status' },
      { id: 'deposit_amount', title: 'deposit_amount' },
      { id: 'created_at', title: 'created_at' },
    ],
  });

  const statusMap: Record<BookingStatus, string> = {
    pending: '待审批',
    approved: '已批准',
    rejected: '已拒绝',
    checked_in: '已签到',
    completed: '已完成',
    cancelled: '已取消',
    no_show: '爽约',
  };

  const records = bookings.map(b => ({
    id: b.id,
    venue_code: b.venue_code || '',
    venue_name: b.venue_name || '',
    user_name: b.user_name || '',
    date: b.date,
    start_time: b.start_time,
    end_time: b.end_time,
    purpose: b.purpose || '',
    status: statusMap[b.status as BookingStatus] || b.status,
    deposit_amount: b.deposit_amount,
    created_at: b.created_at,
  }));

  await csvWriter.writeRecords(records);
}
