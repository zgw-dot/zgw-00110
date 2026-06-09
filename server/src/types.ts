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
  password_hash: string;
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

export interface JWTPayload {
  userId: string;
  username: string;
  role: UserRole;
}
