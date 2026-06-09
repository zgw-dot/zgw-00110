import axios from 'axios';
import {
  User,
  Venue,
  Booking,
  Transaction,
  AuditLog,
  BookingHistory,
  LoginResponse,
  BookingStatus,
  RescheduleRequest,
  RescheduleStatus,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: (username: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { username, password }).then((r) => r.data),

  getMe: () => api.get<User>('/auth/me').then((r) => r.data),

  getUsers: () => api.get<User[]>('/auth/users').then((r) => r.data),

  createUser: (data: {
    username: string;
    password: string;
    name: string;
    role: string;
    initialBalance?: number;
  }) => api.post<User>('/auth/users', data).then((r) => r.data),

  recharge: (userId: string, amount: number) =>
    api.post<User>(`/auth/users/${userId}/recharge`, { amount }).then((r) => r.data),
};

export const venueApi = {
  getVenues: (includeInactive = false) =>
    api.get<Venue[]>(includeInactive ? '/venues/all' : '/venues').then((r) => r.data),

  getVenue: (id: string) => api.get<Venue>(`/venues/${id}`).then((r) => r.data),

  createVenue: (data: {
    code: string;
    name: string;
    description?: string;
    capacity: number;
    depositAmount: number;
  }) => api.post<Venue>('/venues', data).then((r) => r.data),

  updateVenue: (
    id: string,
    data: {
      name?: string;
      description?: string;
      capacity?: number;
      depositAmount?: number;
      isActive?: number;
    }
  ) => api.put<Venue>(`/venues/${id}`, data).then((r) => r.data),

  deleteVenue: (id: string) => api.delete(`/venues/${id}`).then((r) => r.data),

  importVenues: (csvContent: string) =>
    api.post('/venues/import', { csvContent }).then((r) => r.data),

  exportVenues: () =>
    api.get('/venues/export/csv', { responseType: 'blob' }).then((r) => r.data),
};

export const bookingApi = {
  getPendingCount: () =>
    api.get<{ pending: number; approved: number; checkedIn: number; pendingReschedule: number }>('/bookings/pending-count').then((r) => r.data),

  getCalendarBookings: (venueId: string, startDate: string, endDate: string) =>
    api
      .get<Booking[]>('/bookings/calendar', {
        params: { venueId, startDate, endDate },
      })
      .then((r) => r.data),

  checkOverlap: (
    venueId: string,
    date: string,
    startTime: string,
    endTime: string,
    excludeBookingId?: string
  ) =>
    api
      .get<{ hasOverlap: boolean }>('/bookings/check-overlap', {
        params: { venueId, date, startTime, endTime, excludeBookingId },
      })
      .then((r) => r.data),

  getBookings: (params?: {
    venueId?: string;
    status?: BookingStatus;
    date?: string;
    startDate?: string;
    endDate?: string;
    userId?: string;
    page?: number;
    pageSize?: number;
  }) =>
    api
      .get<{ bookings: Booking[]; total: number; page: number; pageSize: number }>('/bookings', {
        params,
      })
      .then((r) => r.data),

  getBooking: (id: string) => api.get<Booking>(`/bookings/${id}`).then((r) => r.data),

  getBookingHistory: (id: string) =>
    api.get<BookingHistory[]>(`/bookings/${id}/history`).then((r) => r.data),

  createBooking: (data: {
    venueId: string;
    date: string;
    startTime: string;
    endTime: string;
    purpose: string;
  }) => api.post<Booking>('/bookings', data).then((r) => r.data),

  approveBooking: (id: string) =>
    api.post<Booking>(`/bookings/${id}/approve`).then((r) => r.data),

  rejectBooking: (id: string, reason: string) =>
    api.post<Booking>(`/bookings/${id}/reject`, { reason }).then((r) => r.data),

  checkIn: (id: string) => api.post<Booking>(`/bookings/${id}/checkin`).then((r) => r.data),

  completeBooking: (id: string) =>
    api.post<Booking>(`/bookings/${id}/complete`).then((r) => r.data),

  cancelBooking: (id: string, reason: string) =>
    api.post<Booking>(`/bookings/${id}/cancel`, { reason }).then((r) => r.data),

  markNoShow: (id: string) =>
    api.post<Booking>(`/bookings/${id}/no-show`).then((r) => r.data),

  exportBookings: (params?: {
    venueId?: string;
    status?: BookingStatus;
    startDate?: string;
    endDate?: string;
  }) =>
    api
      .get('/bookings/export/csv', {
        params,
        responseType: 'blob',
      })
      .then((r) => r.data),

  rescheduleBooking: (bookingId: string, data: {
    newDate: string;
    newStartTime: string;
    newEndTime: string;
    reason: string;
  }) =>
    api.post<RescheduleRequest>(`/bookings/${bookingId}/reschedule`, data).then((r) => r.data),

  getReschedules: (params?: {
    bookingId?: string;
    status?: RescheduleStatus;
    userId?: string;
    page?: number;
    pageSize?: number;
  }) =>
    api
      .get<{ requests: RescheduleRequest[]; total: number; page: number; pageSize: number }>('/bookings/reschedules', {
        params,
      })
      .then((r) => r.data),

  getReschedule: (id: string) =>
    api.get<RescheduleRequest>(`/bookings/reschedules/${id}`).then((r) => r.data),

  approveReschedule: (id: string) =>
    api.post<RescheduleRequest>(`/bookings/reschedules/${id}/approve`).then((r) => r.data),

  rejectReschedule: (id: string, reason: string) =>
    api.post<RescheduleRequest>(`/bookings/reschedules/${id}/reject`, { reason }).then((r) => r.data),
};

export const transactionApi = {
  getMyTransactions: (page = 1, pageSize = 50) =>
    api
      .get<{ transactions: Transaction[]; total: number; page: number; pageSize: number }>(
        '/transactions/my',
        { params: { page, pageSize } }
      )
      .then((r) => r.data),

  getAllTransactions: (page = 1, pageSize = 50) =>
    api
      .get<{ transactions: Transaction[]; total: number; page: number; pageSize: number }>(
        '/transactions',
        { params: { page, pageSize } }
      )
      .then((r) => r.data),

  getBalance: () => api.get<{ balance: number }>('/transactions/balance').then((r) => r.data),

  getUserTransactions: (userId: string, page = 1, pageSize = 50) =>
    api
      .get<{ transactions: Transaction[]; total: number; page: number; pageSize: number }>(
        `/transactions/user/${userId}`,
        { params: { page, pageSize } }
      )
      .then((r) => r.data),
};

export const auditApi = {
  getLogs: (page = 1, pageSize = 50) =>
    api
      .get<{ logs: AuditLog[]; total: number; page: number; pageSize: number }>('/audit', {
        params: { page, pageSize },
      })
      .then((r) => r.data),
};

export default api;
