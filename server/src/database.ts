import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

sqlite3.verbose();

const dbDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'venue-booking.db');
const db = new sqlite3.Database(dbPath);

function run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql: string, params: any[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql: string, params: any[] = []): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function exec(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function serialize(): Promise<void> {
  return new Promise((resolve) => {
    db.serialize(() => resolve());
  });
}

let transactionDepth = 0;
let savepointCounter = 0;

async function runTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const isNested = transactionDepth > 0;
  const savepointName = isNested ? `sp_${++savepointCounter}` : null;

  transactionDepth++;

  try {
    if (isNested && savepointName) {
      await run(`SAVEPOINT ${savepointName}`);
    } else {
      await run('BEGIN TRANSACTION');
    }

    const result = await fn();

    if (isNested && savepointName) {
      await run(`RELEASE SAVEPOINT ${savepointName}`);
    } else {
      await run('COMMIT');
    }

    return result;
  } catch (err) {
    try {
      if (isNested && savepointName) {
        await run(`ROLLBACK TO SAVEPOINT ${savepointName}`);
      } else {
        await run('ROLLBACK');
      }
    } catch (rollbackErr) {
      console.error('Rollback error:', rollbackErr);
    }
    throw err;
  } finally {
    transactionDepth--;
  }
}

export async function initDatabase() {
  await exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'resident')),
      password_hash TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS venues (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      capacity INTEGER NOT NULL DEFAULT 0,
      deposit_amount REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      purpose TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','checked_in','completed','cancelled','no_show')),
      deposit_amount REAL NOT NULL DEFAULT 0,
      deposit_transaction_id TEXT,
      refund_transaction_id TEXT,
      checked_in_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      no_show_at TEXT,
      approved_by TEXT,
      rejected_by TEXT,
      rejection_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (venue_id) REFERENCES venues(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      booking_id TEXT,
      type TEXT NOT NULL CHECK(type IN ('deposit_freeze','deposit_release','deposit_refund','deposit_deduct','deposit_recharge')),
      amount REAL NOT NULL,
      balance_before REAL NOT NULL,
      balance_after REAL NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (booking_id) REFERENCES bookings(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      booking_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS booking_histories (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      status_from TEXT,
      status_to TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      changed_by_name TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(id)
    );

    CREATE TABLE IF NOT EXISTS reschedule_requests (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      old_date TEXT NOT NULL,
      old_start_time TEXT NOT NULL,
      old_end_time TEXT NOT NULL,
      new_date TEXT NOT NULL,
      new_start_time TEXT NOT NULL,
      new_end_time TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
      handled_by TEXT,
      handled_by_name TEXT,
      handled_at TEXT,
      rejection_reason TEXT,
      withdraw_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES bookings(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_venue_date ON bookings(venue_id, date);
    CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_booking_histories_booking ON booking_histories(booking_id);
    CREATE INDEX IF NOT EXISTS idx_reschedule_booking ON reschedule_requests(booking_id);
    CREATE INDEX IF NOT EXISTS idx_reschedule_user ON reschedule_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_reschedule_status ON reschedule_requests(status);
  `);

  const existingTable = await get("SELECT sql FROM sqlite_master WHERE type='table' AND name='reschedule_requests'");
  if (existingTable && existingTable.sql) {
    if (!existingTable.sql.includes("'withdrawn'")) {
      await runTransaction(async () => {
        await exec(`
          CREATE TABLE IF NOT EXISTS reschedule_requests_new (
            id TEXT PRIMARY KEY,
            booking_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            old_date TEXT NOT NULL,
            old_start_time TEXT NOT NULL,
            old_end_time TEXT NOT NULL,
            new_date TEXT NOT NULL,
            new_start_time TEXT NOT NULL,
            new_end_time TEXT NOT NULL,
            reason TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
            handled_by TEXT,
            handled_by_name TEXT,
            handled_at TEXT,
            rejection_reason TEXT,
            withdraw_reason TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (booking_id) REFERENCES bookings(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
          );
        `);
        await exec(`
          INSERT INTO reschedule_requests_new 
          SELECT id, booking_id, user_id, old_date, old_start_time, old_end_time, 
                 new_date, new_start_time, new_end_time, reason, status, 
                 handled_by, handled_by_name, handled_at, rejection_reason, 
                 NULL as withdraw_reason, created_at, updated_at
          FROM reschedule_requests;
        `);
        await exec(`DROP TABLE reschedule_requests;`);
        await exec(`ALTER TABLE reschedule_requests_new RENAME TO reschedule_requests;`);
      });
      console.log('[Migration] reschedule_requests 表已升级，支持 withdrawn 状态');
    }

    const columns = await all("PRAGMA table_info(reschedule_requests)") as any[];
    const hasColumn = columns.some((col: any) => col.name === 'withdraw_reason');
    if (!hasColumn) {
      await exec(`ALTER TABLE reschedule_requests ADD COLUMN withdraw_reason TEXT;`);
      console.log('[Migration] 已添加 withdraw_reason 列');
    }
  }
}

export default {
  run,
  get,
  all,
  exec,
  serialize,
  runTransaction,
};
