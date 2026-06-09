import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../database';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config';
import { User, UserRole, JWTPayload } from '../types';
import { createTransaction } from './transactionService';

export interface LoginResult {
  token: string;
  user: Omit<User, 'password_hash'>;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]) as User | undefined;
  if (!user) {
    throw new Error('用户名或密码错误');
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw new Error('用户名或密码错误');
  }

  const payload: JWTPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  const { password_hash, ...userWithoutPassword } = user;
  return { token, user: userWithoutPassword };
}

export interface CreateUserParams {
  username: string;
  password: string;
  name: string;
  role: UserRole;
  initialBalance?: number;
  createdBy: string;
}

export async function createUser(params: CreateUserParams): Promise<Omit<User, 'password_hash'>> {
  const existing = await db.get('SELECT id FROM users WHERE username = ?', [params.username]);
  if (existing) {
    throw new Error('用户名已存在');
  }

  const passwordHash = await bcrypt.hash(params.password, 10);
  const userId = uuidv4();

  await db.runTransaction(async () => {
    await db.run(`
      INSERT INTO users (id, username, name, role, password_hash, balance)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [userId, params.username, params.name, params.role, passwordHash, 0]);

    if (params.initialBalance && params.initialBalance > 0) {
      await createTransaction({
        userId,
        bookingId: null,
        type: 'deposit_recharge',
        amount: params.initialBalance,
        description: '初始余额充值',
        createdBy: params.createdBy,
      });
    }
  });

  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]) as User;
  const { password_hash, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

export async function getUserById(userId: string): Promise<Omit<User, 'password_hash'> | undefined> {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]) as User | undefined;
  if (!user) return undefined;
  const { password_hash, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

export async function getAllUsers(): Promise<Omit<User, 'password_hash'>[]> {
  const users = await db.all('SELECT * FROM users ORDER BY created_at DESC', []) as User[];
  return users.map(({ password_hash, ...rest }) => rest);
}

export async function rechargeBalance(userId: string, amount: number, operatorId: string): Promise<Omit<User, 'password_hash'>> {
  if (amount <= 0) {
    throw new Error('充值金额必须大于0');
  }

  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]) as User | undefined;
  if (!user) {
    throw new Error('用户不存在');
  }

  await createTransaction({
    userId,
    bookingId: null,
    type: 'deposit_recharge',
    amount,
    description: '管理员充值',
    createdBy: operatorId,
  });

  const updatedUser = await db.get('SELECT * FROM users WHERE id = ?', [userId]) as User;
  const { password_hash, ...userWithoutPassword } = updatedUser;
  return userWithoutPassword;
}
