import { v4 as uuidv4 } from 'uuid';
import db from '../database';
import { TransactionType, JWTPayload, Transaction } from '../types';

export interface CreateTransactionParams {
  userId: string;
  bookingId: string | null;
  type: TransactionType;
  amount: number;
  description: string;
  createdBy: string;
}

export async function createTransaction(params: CreateTransactionParams): Promise<Transaction> {
  const { userId, bookingId, type, amount, description, createdBy } = params;

  return await db.runTransaction(async () => {
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      throw new Error('用户不存在');
    }

    const currentUser = user as { balance: number };
    const balanceBefore = currentUser.balance;
    let balanceAfter = balanceBefore;

    switch (type) {
      case 'deposit_freeze':
      case 'deposit_deduct':
        if (balanceBefore < amount) {
          throw new Error('余额不足');
        }
        balanceAfter = balanceBefore - amount;
        break;
      case 'deposit_release':
      case 'deposit_refund':
      case 'deposit_recharge':
        balanceAfter = balanceBefore + amount;
        break;
      default:
        throw new Error('无效的交易类型');
    }

    await db.run('UPDATE users SET balance = ? WHERE id = ?', [balanceAfter, userId]);

    const transactionId = uuidv4();
    await db.run(`
      INSERT INTO transactions (id, user_id, booking_id, type, amount, balance_before, balance_after, description, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [transactionId, userId, bookingId, type, amount, balanceBefore, balanceAfter, description, createdBy]);

    const transaction = await db.get('SELECT * FROM transactions WHERE id = ?', [transactionId]) as Transaction;
    return transaction;
  });
}

export async function reverseTransaction(transactionId: string, reversedBy: string): Promise<Transaction> {
  const originalTx = await db.get('SELECT * FROM transactions WHERE id = ?', [transactionId]) as Transaction | undefined;
  if (!originalTx) {
    throw new Error('原始交易不存在');
  }

  if (originalTx.type === 'deposit_recharge') {
    throw new Error('充值交易不可冲销');
  }

  const user = await db.get('SELECT * FROM users WHERE id = ?', [originalTx.user_id]) as { balance: number };
  if (!user) {
    throw new Error('用户不存在');
  }

  let reverseType: TransactionType;
  let reverseAmount = originalTx.amount;
  let description = '';

  switch (originalTx.type) {
    case 'deposit_freeze':
      reverseType = 'deposit_release';
      description = `冲销冻结交易: ${transactionId}`;
      break;
    case 'deposit_release':
      reverseType = 'deposit_freeze';
      if (user.balance < reverseAmount) {
        throw new Error('余额不足，无法冲销');
      }
      description = `冲销解冻交易: ${transactionId}`;
      break;
    case 'deposit_refund':
      reverseType = 'deposit_deduct';
      if (user.balance < reverseAmount) {
        throw new Error('余额不足，无法冲销');
      }
      description = `冲销退款交易: ${transactionId}`;
      break;
    case 'deposit_deduct':
      reverseType = 'deposit_refund';
      description = `冲销扣款交易: ${transactionId}`;
      break;
    default:
      throw new Error('不支持冲销的交易类型');
  }

  return await createTransaction({
    userId: originalTx.user_id,
    bookingId: originalTx.booking_id,
    type: reverseType,
    amount: reverseAmount,
    description,
    createdBy: reversedBy,
  });
}

export async function getUserTransactions(userId: string, page: number = 1, pageSize: number = 50) {
  const offset = (page - 1) * pageSize;
  const transactions = await db.all(`
    SELECT t.*, b.date as booking_date, v.name as venue_name
    FROM transactions t
    LEFT JOIN bookings b ON t.booking_id = b.id
    LEFT JOIN venues v ON b.venue_id = v.id
    WHERE t.user_id = ?
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `, [userId, pageSize, offset]);

  const total = await db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ?', [userId]) as { count: number };

  return {
    transactions,
    total: total.count,
    page,
    pageSize,
  };
}

export async function getAllTransactions(page: number = 1, pageSize: number = 50) {
  const offset = (page - 1) * pageSize;
  const transactions = await db.all(`
    SELECT t.*, u.name as user_name, b.date as booking_date, v.name as venue_name
    FROM transactions t
    LEFT JOIN users u ON t.user_id = u.id
    LEFT JOIN bookings b ON t.booking_id = b.id
    LEFT JOIN venues v ON b.venue_id = v.id
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `, [pageSize, offset]);

  const total = await db.get('SELECT COUNT(*) as count FROM transactions') as { count: number };

  return {
    transactions,
    total: total.count,
    page,
    pageSize,
  };
}

export async function getUserBalance(userId: string): Promise<number> {
  const user = await db.get('SELECT balance FROM users WHERE id = ?', [userId]) as { balance: number } | undefined;
  if (!user) {
    throw new Error('用户不存在');
  }
  return user.balance;
}
