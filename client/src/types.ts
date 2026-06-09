export type UserRole = 'admin' | 'resident';

export type BookingStatus = 
  | 'pending'      
  | 'approved'     
  | 'rejected'     
  | 'checked_in'   
  | 'completed'    
  | 'cancelled'    
  | 'no_show';     

export type TransactionType = 
  | 'deposit_freeze'     
  | 'deposit_release'    
  | 'deposit_refund'     
  | 'deposit_deduct'     
  | 'deposit_recharge';  

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  balance: number;
  created_at: string;
}

export interface Venue {
  id: string;
  code: string;
  name: string;
  description: string;
  capacity: number;
  deposit_amount: number;
  is_active: number;
  created_at: string;
}

export interface Booking {
  id: string;
  venue_id: string;
  user_id: string;
  date: string;
  start_time: string;
  end_time: string;
  purpose: string;
  status: BookingStatus;
  deposit_amount: number;
  deposit_transaction_id: string | null;
  refund_transaction_id: string | null;
  checked_in_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  no_show_at: string | null;
  approved_by: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  venue_name?: string;
  venue_code?: string;
  user_name?: string;
  user_username?: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  booking_id: string | null;
  type: TransactionType;
  amount: number;
  balance_before: number;
  balance_after: number;
  description: string;
  created_by: string;
  created_at: string;
  user_name?: string;
  booking_date?: string;
  venue_name?: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  booking_id: string | null;
  details: string;
  ip_address: string;
  created_at: string;
  user_display_name?: string;
}

export interface BookingHistory {
  id: string;
  booking_id: string;
  status_from: BookingStatus | null;
  status_to: BookingStatus;
  changed_by: string;
  changed_by_name: string;
  reason: string | null;
  created_at: string;
}

export type RescheduleStatus =
  | 'pending'
  | 'approved'
  | 'rejected';

export interface RescheduleRequest {
  id: string;
  booking_id: string;
  user_id: string;
  old_date: string;
  old_start_time: string;
  old_end_time: string;
  new_date: string;
  new_start_time: string;
  new_end_time: string;
  reason: string;
  status: RescheduleStatus;
  handled_by: string | null;
  handled_by_name: string | null;
  handled_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  venue_name?: string;
  venue_code?: string;
  user_name?: string;
  user_username?: string;
}

export const RESCHEDULE_STATUS_TEXT: Record<RescheduleStatus, string> = {
  pending: '待处理',
  approved: '已同意',
  rejected: '已拒绝',
};

export const RESCHEDULE_STATUS_COLOR: Record<RescheduleStatus, string> = {
  pending: 'orange',
  approved: 'green',
  rejected: 'red',
};

export interface LoginResponse {
  token: string;
  user: User;
}

export const STATUS_TEXT: Record<BookingStatus, string> = {
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  checked_in: '已签到',
  completed: '已完成',
  cancelled: '已取消',
  no_show: '爽约',
};

export const STATUS_COLOR: Record<BookingStatus, string> = {
  pending: 'orange',
  approved: 'blue',
  rejected: 'red',
  checked_in: 'cyan',
  completed: 'green',
  cancelled: 'default',
  no_show: 'magenta',
};

export const TRANSACTION_TEXT: Record<TransactionType, string> = {
  deposit_freeze: '押金冻结',
  deposit_release: '押金解冻',
  deposit_refund: '押金退还',
  deposit_deduct: '押金扣除',
  deposit_recharge: '余额充值',
};

export const TRANSACTION_COLOR: Record<TransactionType, string> = {
  deposit_freeze: 'orange',
  deposit_release: 'cyan',
  deposit_refund: 'green',
  deposit_deduct: 'red',
  deposit_recharge: 'blue',
};
