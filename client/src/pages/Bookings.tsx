import React, { useState, useEffect } from 'react';
import {
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  TimePicker,
  Tabs,
  message,
  Typography,
  Popconfirm,
  Drawer,
  Descriptions,
  Timeline,
  Card,
  Row,
  Col,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  CalendarOutlined,
  UserOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  StopOutlined,
  DownloadOutlined,
  EditOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { bookingApi, venueApi } from '../services/api';
import {
  Booking,
  BookingStatus,
  STATUS_TEXT,
  STATUS_COLOR,
  BookingHistory,
  RescheduleRequest,
  RescheduleStatus,
  RESCHEDULE_STATUS_TEXT,
  RESCHEDULE_STATUS_COLOR,
} from '../types';

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

export default function Bookings() {
  const { user, refreshUser } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState({
    status: '' as BookingStatus | '',
    venueId: '',
    date: null as any,
  });

  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [history, setHistory] = useState<BookingHistory[]>([]);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [rescheduleModalVisible, setRescheduleModalVisible] = useState(false);
  const [rescheduleRejectModalVisible, setRescheduleRejectModalVisible] = useState(false);
  const [rescheduleForm] = Form.useForm();
  const [rescheduleRejectForm] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [cancelForm] = Form.useForm();
  const [reschedules, setReschedules] = useState<RescheduleRequest[]>([]);
  const [reschedulesLoading, setReschedulesLoading] = useState(false);
  const [selectedReschedule, setSelectedReschedule] = useState<RescheduleRequest | null>(null);
  const [activeTab, setActiveTab] = useState<'bookings' | 'reschedules'>('bookings');
  const [checkingOverlap, setCheckingOverlap] = useState(false);

  useEffect(() => {
    loadBookings();
  }, [page, pageSize, filters, user]);

  useEffect(() => {
    if (activeTab === 'reschedules' && user) {
      loadReschedules();
    }
  }, [activeTab, user]);

  const loadReschedules = async () => {
    setReschedulesLoading(true);
    try {
      const result = await bookingApi.getReschedules({ pageSize: 100 });
      setReschedules(result.requests);
    } catch (err) {
      message.error('加载改期列表失败');
    } finally {
      setReschedulesLoading(false);
    }
  };

  const loadBookings = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (filters.status) params.status = filters.status;
      if (filters.venueId) params.venueId = filters.venueId;
      if (filters.date) params.date = filters.date.format('YYYY-MM-DD');

      const result = await bookingApi.getBookings(params);
      setBookings(result.bookings);
      setTotal(result.total);
    } catch (err) {
      message.error('加载预约列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetail = async (booking: Booking) => {
    setSelectedBooking(booking);
    try {
      const [detail, historyData] = await Promise.all([
        bookingApi.getBooking(booking.id),
        bookingApi.getBookingHistory(booking.id),
      ]);
      setSelectedBooking(detail as Booking);
      setHistory(historyData);
    } catch (err) {
      console.error(err);
    }
    setDetailVisible(true);
  };

  const handleApprove = async (id: string) => {
    try {
      await bookingApi.approveBooking(id);
      message.success('审批通过');
      loadBookings();
      refreshUser();
    } catch (err: any) {
      message.error(err.response?.data?.error || '审批失败');
    }
  };

  const handleReject = async (values: any) => {
    if (!selectedBooking) return;
    try {
      await bookingApi.rejectBooking(selectedBooking.id, values.reason);
      message.success('已拒绝预约');
      setRejectModalVisible(false);
      rejectForm.resetFields();
      loadBookings();
      refreshUser();
    } catch (err: any) {
      message.error(err.response?.data?.error || '拒绝失败');
    }
  };

  const handleCheckIn = async (id: string) => {
    try {
      await bookingApi.checkIn(id);
      message.success('签到成功');
      loadBookings();
    } catch (err: any) {
      message.error(err.response?.data?.error || '签到失败');
    }
  };

  const handleComplete = async (id: string) => {
    try {
      await bookingApi.completeBooking(id);
      message.success('核销完成，押金已退还');
      loadBookings();
      refreshUser();
    } catch (err: any) {
      message.error(err.response?.data?.error || '核销失败');
    }
  };

  const handleCancel = async (values: any) => {
    if (!selectedBooking) return;
    try {
      await bookingApi.cancelBooking(selectedBooking.id, values.reason);
      message.success('预约已取消');
      setCancelModalVisible(false);
      cancelForm.resetFields();
      loadBookings();
      refreshUser();
    } catch (err: any) {
      message.error(err.response?.data?.error || '取消失败');
    }
  };

  const handleNoShow = async (id: string) => {
    try {
      await bookingApi.markNoShow(id);
      message.success('已标记为爽约，押金将被扣除');
      loadBookings();
    } catch (err: any) {
      message.error(err.response?.data?.error || '标记失败');
    }
  };

  const handleReschedule = async (values: any) => {
    if (!selectedBooking) return;
    try {
      const newDate = values.newDate.format('YYYY-MM-DD');
      const newStartTime = values.newTimeRange[0].format('HH:mm');
      const newEndTime = values.newTimeRange[1].format('HH:mm');

      setCheckingOverlap(true);
      const overlapResult = await bookingApi.checkOverlap(
        selectedBooking.venue_id,
        newDate,
        newStartTime,
        newEndTime,
        selectedBooking.id
      );
      setCheckingOverlap(false);

      if (overlapResult.hasOverlap) {
        message.error('该时段已被占用，请选择其他时间');
        return;
      }

      await bookingApi.rescheduleBooking(selectedBooking.id, {
        newDate,
        newStartTime,
        newEndTime,
        reason: values.reason,
      });
      message.success('改期申请已提交，等待管理员审核');
      setRescheduleModalVisible(false);
      rescheduleForm.resetFields();
      loadBookings();
    } catch (err: any) {
      setCheckingOverlap(false);
      message.error(err.response?.data?.error || '改期申请失败');
    }
  };

  const handleApproveReschedule = async (id: string) => {
    try {
      await bookingApi.approveReschedule(id);
      message.success('改期已同意');
      loadReschedules();
      loadBookings();
      refreshUser();
    } catch (err: any) {
      message.error(err.response?.data?.error || '同意改期失败');
    }
  };

  const handleRejectReschedule = async (values: any) => {
    if (!selectedReschedule) return;
    try {
      await bookingApi.rejectReschedule(selectedReschedule.id, values.reason);
      message.success('改期已拒绝');
      setRescheduleRejectModalVisible(false);
      rescheduleRejectForm.resetFields();
      loadReschedules();
    } catch (err: any) {
      message.error(err.response?.data?.error || '拒绝改期失败');
    }
  };

  const handleExport = async () => {
    try {
      const params: any = {};
      if (filters.status) params.status = filters.status;
      if (filters.venueId) params.venueId = filters.venueId;

      const blob = await bookingApi.exportBookings(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bookings_${dayjs().format('YYYYMMDD_HHmmss')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch (err) {
      message.error('导出失败');
    }
  };

  const renderActions = (booking: Booking) => {
    const actions: React.ReactNode[] = [
      <Button key="view" type="link" icon={<EyeOutlined />} onClick={() => handleViewDetail(booking)}>
        详情
      </Button>,
    ];

    if (user?.role === 'admin') {
      if (booking.status === 'pending') {
        actions.push(
          <Button
            key="approve"
            type="link"
            icon={<CheckOutlined />}
            onClick={() => handleApprove(booking.id)}
          >
            通过
          </Button>
        );
        actions.push(
          <Button
            key="reject"
            type="link"
            danger
            icon={<CloseOutlined />}
            onClick={() => {
              setSelectedBooking(booking);
              setRejectModalVisible(true);
            }}
          >
            拒绝
          </Button>
        );
      }
      if (booking.status === 'approved') {
        actions.push(
          <Button
            key="checkin"
            type="link"
            icon={<CheckCircleOutlined />}
            onClick={() => handleCheckIn(booking.id)}
          >
            签到
          </Button>
        );
        actions.push(
          <Popconfirm
            key="noshow"
            title="确认标记为爽约？"
            description="爽约将扣除押金"
            onConfirm={() => handleNoShow(booking.id)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" danger icon={<StopOutlined />}>
              爽约
            </Button>
          </Popconfirm>
        );
      }
      if (booking.status === 'checked_in') {
        actions.push(
          <Button
            key="complete"
            type="link"
            icon={<CheckOutlined />}
            onClick={() => handleComplete(booking.id)}
          >
            核销
          </Button>
        );
      }
    }

    if (
      (booking.status === 'pending' || booking.status === 'approved') &&
      (user?.role === 'admin' || booking.user_id === user?.id)
    ) {
      actions.push(
        <Button
          key="cancel"
          type="link"
          danger
          onClick={() => {
            setSelectedBooking(booking);
            setCancelModalVisible(true);
          }}
        >
          取消
        </Button>
      );
    }

    if (
      (booking.status === 'pending' || booking.status === 'approved') &&
      user?.role === 'resident' &&
      booking.user_id === user?.id
    ) {
      const hasPendingReschedule = reschedules.some(
        (r) => r.booking_id === booking.id && r.status === 'pending'
      );
      actions.push(
        <Button
          key="reschedule"
          type="link"
          icon={<SwapOutlined />}
          onClick={() => {
            setSelectedBooking(booking);
            rescheduleForm.setFieldsValue({
              newDate: dayjs(booking.date),
              newTimeRange: [dayjs(`2000-01-01 ${booking.start_time}`), dayjs(`2000-01-01 ${booking.end_time}`)],
            });
            setRescheduleModalVisible(true);
          }}
          disabled={hasPendingReschedule}
        >
          {hasPendingReschedule ? '改期审核中' : '改期'}
        </Button>
      );
    }

    return <Space>{actions}</Space>;
  };

  const columns = [
    {
      title: '场地',
      dataIndex: 'venue_name',
      key: 'venue_name',
      render: (text: string, record: Booking) => (
        <div>
          <Text strong>{text}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.venue_code}
          </Text>
        </div>
      ),
    },
    {
      title: '用户',
      dataIndex: 'user_name',
      key: 'user_name',
      hidden: user?.role !== 'admin',
    },
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      render: (text: string, record: Booking) => (
        <div>
          <Text>{text}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.start_time} - {record.end_time}
          </Text>
        </div>
      ),
    },
    {
      title: '押金',
      dataIndex: 'deposit_amount',
      key: 'deposit_amount',
      render: (val: number) => `¥${val.toFixed(2)}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: BookingStatus) => (
        <Tag color={STATUS_COLOR[status]}>{STATUS_TEXT[status]}</Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => dayjs(text).format('MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: Booking) => renderActions(record),
    },
  ];

  const rescheduleColumns = [
    {
      title: '场地',
      dataIndex: 'venue_name',
      key: 'venue_name',
      render: (text: string, record: RescheduleRequest) => (
        <div>
          <Text strong>{text}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.venue_code}
          </Text>
        </div>
      ),
    },
    {
      title: '用户',
      dataIndex: 'user_name',
      key: 'user_name',
      hidden: user?.role !== 'admin',
    },
    {
      title: '原时间',
      key: 'old_time',
      render: (_: any, record: RescheduleRequest) => (
        <div>
          <Text>{record.old_date}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.old_start_time} - {record.old_end_time}
          </Text>
        </div>
      ),
    },
    {
      title: '新时间',
      key: 'new_time',
      render: (_: any, record: RescheduleRequest) => (
        <div>
          <Text>{record.new_date}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.new_start_time} - {record.new_end_time}
          </Text>
        </div>
      ),
    },
    {
      title: '改期原因',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: RescheduleStatus) => (
        <Tag color={RESCHEDULE_STATUS_COLOR[status as keyof typeof RESCHEDULE_STATUS_COLOR]}>
          {RESCHEDULE_STATUS_TEXT[status as keyof typeof RESCHEDULE_STATUS_TEXT]}
        </Tag>
      ),
    },
    {
      title: '申请时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text: string) => dayjs(text).format('MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: RescheduleRequest) => {
        const actions: React.ReactNode[] = [];
        if (user?.role === 'admin' && record.status === 'pending') {
          actions.push(
            <Button
              key="approve"
              type="link"
              icon={<CheckOutlined />}
              onClick={() => handleApproveReschedule(record.id)}
            >
              同意
            </Button>
          );
          actions.push(
            <Button
              key="reject"
              type="link"
              danger
              icon={<CloseOutlined />}
              onClick={() => {
                setSelectedReschedule(record);
                setRescheduleRejectModalVisible(true);
              }}
            >
              拒绝
            </Button>
          );
        }
        if (record.rejection_reason) {
          actions.push(
            <Button
              key="view-reason"
              type="link"
              onClick={() => message.info(`拒绝原因: ${record.rejection_reason}`)}
            >
              查看拒绝原因
            </Button>
          );
        }
        return <Space>{actions}</Space>;
      },
    },
  ];

  const filteredColumns = columns.filter((col: any) => !col.hidden);
  const filteredRescheduleColumns = rescheduleColumns.filter((col: any) => !col.hidden);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <CalendarOutlined /> {user?.role === 'admin' ? '预约管理' : '我的预约'}
        </Title>
        <Space>
          {user?.role === 'admin' && (
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出CSV
            </Button>
          )}
        </Space>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'bookings' | 'reschedules')}
        style={{ marginBottom: 16 }}
        items={[
          {
            key: 'bookings',
            label: '预约列表',
          },
          {
            key: 'reschedules',
            label: user?.role === 'admin' ? '改期申请' : '我的改期',
          },
        ]}
      />

      {activeTab === 'bookings' && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <Space wrap size={16}>
              <Select
                style={{ width: 150 }}
                placeholder="状态筛选"
                allowClear
                value={filters.status || undefined}
                onChange={(val) => setFilters({ ...filters, status: val || '' })}
              >
                <Option value="pending">待审批</Option>
                <Option value="approved">已批准</Option>
                <Option value="checked_in">已签到</Option>
                <Option value="completed">已完成</Option>
                <Option value="cancelled">已取消</Option>
                <Option value="rejected">已拒绝</Option>
                <Option value="no_show">爽约</Option>
              </Select>
              <DatePicker
                placeholder="选择日期"
                allowClear
                value={filters.date}
                onChange={(date) => setFilters({ ...filters, date })}
              />
              <Button onClick={loadBookings} type="primary">
                查询
              </Button>
              <Button
                onClick={() => {
                  setFilters({ status: '', venueId: '', date: null });
                  setPage(1);
                }}
              >
                重置
              </Button>
            </Space>
          </Card>

          <Table
            loading={loading}
            dataSource={bookings}
            columns={filteredColumns}
            rowKey="id"
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (t) => `共 ${t} 条`,
            }}
          />
        </>
      )}

      {activeTab === 'reschedules' && (
        <Table
          loading={reschedulesLoading}
          dataSource={reschedules}
          columns={filteredRescheduleColumns}
          rowKey="id"
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (t) => `共 ${t} 条`,
          }}
        />
      )}

      <Drawer
        title="预约详情"
        width={600}
        open={detailVisible}
        onClose={() => setDetailVisible(false)}
      >
        {selectedBooking && (
          <div>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="场地">
                {selectedBooking.venue_name} ({selectedBooking.venue_code})
              </Descriptions.Item>
              <Descriptions.Item label="用户">
                {selectedBooking.user_name} ({selectedBooking.user_username})
              </Descriptions.Item>
              <Descriptions.Item label="日期">
                {selectedBooking.date} {selectedBooking.start_time} - {selectedBooking.end_time}
              </Descriptions.Item>
              <Descriptions.Item label="用途">{selectedBooking.purpose || '-'}</Descriptions.Item>
              <Descriptions.Item label="押金">¥{selectedBooking.deposit_amount.toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_COLOR[selectedBooking.status]}>
                  {STATUS_TEXT[selectedBooking.status]}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {dayjs(selectedBooking.created_at).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              {selectedBooking.checked_in_at && (
                <Descriptions.Item label="签到时间">
                  {dayjs(selectedBooking.checked_in_at).format('YYYY-MM-DD HH:mm:ss')}
                </Descriptions.Item>
              )}
              {selectedBooking.completed_at && (
                <Descriptions.Item label="核销时间">
                  {dayjs(selectedBooking.completed_at).format('YYYY-MM-DD HH:mm:ss')}
                </Descriptions.Item>
              )}
              {selectedBooking.rejection_reason && (
                <Descriptions.Item label="拒绝原因">{selectedBooking.rejection_reason}</Descriptions.Item>
              )}
            </Descriptions>

            <Title level={5} style={{ marginTop: 24, marginBottom: 12 }}>
              <HistoryOutlined /> 状态流转历史
            </Title>
            <Timeline
              items={history.map((h) => ({
                color: STATUS_COLOR[h.status_to] as any,
                children: (
                  <div>
                    <Text strong>{STATUS_TEXT[h.status_to]}</Text>
                    {h.status_from && (
                      <Text type="secondary">
                        {' '}
                        ← {STATUS_TEXT[h.status_from]}
                      </Text>
                    )}
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {h.changed_by_name} · {dayjs(h.created_at).format('YYYY-MM-DD HH:mm')}
                    </Text>
                    {h.reason && (
                      <>
                        <br />
                        <Text style={{ fontSize: 12 }}>原因: {h.reason}</Text>
                      </>
                    )}
                  </div>
                ),
              }))}
            />
          </div>
        )}
      </Drawer>

      <Modal
        title="拒绝预约"
        open={rejectModalVisible}
        onCancel={() => setRejectModalVisible(false)}
        footer={null}
      >
        <Form form={rejectForm} layout="vertical" onFinish={handleReject}>
          <Form.Item
            name="reason"
            label="拒绝原因"
            rules={[{ required: true, message: '请输入拒绝原因' }]}
          >
            <TextArea rows={4} placeholder="请输入拒绝原因" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => setRejectModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" danger>
                确认拒绝
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="取消预约"
        open={cancelModalVisible}
        onCancel={() => setCancelModalVisible(false)}
        footer={null}
      >
        <Form form={cancelForm} layout="vertical" onFinish={handleCancel}>
          <Form.Item
            name="reason"
            label="取消原因"
            rules={[{ required: true, message: '请输入取消原因' }]}
          >
            <TextArea rows={4} placeholder="请输入取消原因" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => setCancelModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" danger>
                确认取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="申请改期"
        open={rescheduleModalVisible}
        onCancel={() => setRescheduleModalVisible(false)}
        footer={null}
        width={500}
      >
        {selectedBooking && (
          <div style={{ marginBottom: 16 }}>
            <Card size="small" title="当前预约">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="场地">
                  {selectedBooking.venue_name}
                </Descriptions.Item>
                <Descriptions.Item label="时间">
                  {selectedBooking.date} {selectedBooking.start_time} - {selectedBooking.end_time}
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </div>
        )}
        <Form form={rescheduleForm} layout="vertical" onFinish={handleReschedule}>
          <Form.Item
            name="newDate"
            label="新日期"
            rules={[{ required: true, message: '请选择新日期' }]}
          >
            <DatePicker
              style={{ width: '100%' }}
              disabledDate={(current) => current && current < dayjs().startOf('day')}
              placeholder="选择新日期"
            />
          </Form.Item>
          <Form.Item
            name="newTimeRange"
            label="新时间段"
            rules={[{ required: true, message: '请选择新时间段' }]}
          >
            <TimePicker.RangePicker
              style={{ width: '100%' }}
              format="HH:mm"
              minuteStep={30}
              placeholder={['开始时间', '结束时间']}
            />
          </Form.Item>
          <Form.Item
            name="reason"
            label="改期原因"
            rules={[{ required: true, message: '请输入改期原因' }]}
          >
            <TextArea rows={4} placeholder="请详细说明改期原因" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => setRescheduleModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={checkingOverlap}>
                提交申请
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="拒绝改期申请"
        open={rescheduleRejectModalVisible}
        onCancel={() => setRescheduleRejectModalVisible(false)}
        footer={null}
      >
        <Form form={rescheduleRejectForm} layout="vertical" onFinish={handleRejectReschedule}>
          <Form.Item
            name="reason"
            label="拒绝原因"
            rules={[{ required: true, message: '请输入拒绝原因' }]}
          >
            <TextArea rows={4} placeholder="请输入拒绝原因" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => setRescheduleRejectModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" danger>
                确认拒绝
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
