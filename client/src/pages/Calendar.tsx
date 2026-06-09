import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Select,
  DatePicker,
  Button,
  Modal,
  Form,
  Input,
  TimePicker,
  message,
  Tag,
  List,
  Typography,
  Space,
  Tooltip,
} from 'antd';
import {
  CalendarOutlined,
  PlusOutlined,
  ClockCircleOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { venueApi, bookingApi } from '../services/api';
import { Venue, Booking, STATUS_TEXT, STATUS_COLOR } from '../types';

const { Title, Text } = Typography;
const { RangePicker } = TimePicker;
const { Option } = Select;
const { TextArea } = Input;

export default function Calendar() {
  const { user, refreshUser } = useAuth();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedVenue, setSelectedVenue] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Dayjs>(dayjs());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [checkingOverlap, setCheckingOverlap] = useState(false);

  useEffect(() => {
    loadVenues();
  }, []);

  useEffect(() => {
    if (selectedVenue) {
      loadBookings();
    }
  }, [selectedVenue, selectedDate]);

  const loadVenues = async () => {
    try {
      const data = await venueApi.getVenues();
      setVenues(data);
      if (data.length > 0) {
        setSelectedVenue(data[0].id);
      }
    } catch (err) {
      message.error('加载场地列表失败');
    }
  };

  const loadBookings = async () => {
    if (!selectedVenue) return;
    setLoading(true);
    try {
      const startDate = selectedDate.startOf('month').format('YYYY-MM-DD');
      const endDate = selectedDate.endOf('month').format('YYYY-MM-DD');
      const data = await bookingApi.getCalendarBookings(selectedVenue, startDate, endDate);
      setBookings(data);
    } catch (err) {
      message.error('加载预约数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDateSelect = (date: Dayjs) => {
    setSelectedDate(date);
  };

  const handleCreateBooking = async (values: any) => {
    if (!selectedVenue) {
      message.error('请先选择场地');
      return;
    }

    const venue = venues.find((v) => v.id === selectedVenue);
    if (!venue) return;

    const date = selectedDate.format('YYYY-MM-DD');
    const startTime = values.timeRange[0].format('HH:mm');
    const endTime = values.timeRange[1].format('HH:mm');

    setCheckingOverlap(true);
    try {
      const overlap = await bookingApi.checkOverlap(selectedVenue, date, startTime, endTime);
      if (overlap.hasOverlap) {
        message.error('该时段已被预约，请选择其他时段');
        return;
      }

      await bookingApi.createBooking({
        venueId: selectedVenue,
        date,
        startTime,
        endTime,
        purpose: values.purpose,
      });

      message.success('预约申请已提交，押金已冻结，请等待审批');
      setModalVisible(false);
      form.resetFields();
      loadBookings();
      refreshUser();
    } catch (err: any) {
      message.error(err.response?.data?.error || '提交预约失败');
    } finally {
      setCheckingOverlap(false);
    }
  };

  const selectedVenueInfo = venues.find((v) => v.id === selectedVenue);

  const daysInMonth = selectedDate.daysInMonth();
  const firstDay = selectedDate.startOf('month').day();
  const calendarDays: (Dayjs | null)[] = [];

  for (let i = 0; i < firstDay; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(selectedDate.date(i));
  }

  const getBookingsForDay = (date: Dayjs | null) => {
    if (!date) return [];
    const dateStr = date.format('YYYY-MM-DD');
    return bookings.filter((b) => b.date === dateStr);
  };

  const isToday = (date: Dayjs | null) => {
    return date && date.format('YYYY-MM-DD') === dayjs().format('YYYY-MM-DD');
  };

  const isSelected = (date: Dayjs | null) => {
    return date && date.format('YYYY-MM-DD') === selectedDate.format('YYYY-MM-DD');
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <CalendarOutlined /> 场地日历
        </Title>
        {user?.role === 'resident' && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
            提交预约申请
          </Button>
        )}
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <Space>
                <Select
                  style={{ width: 200 }}
                  value={selectedVenue}
                  onChange={setSelectedVenue}
                  placeholder="选择场地"
                >
                  {venues.map((v) => (
                    <Option key={v.id} value={v.id}>
                      {v.code} - {v.name}
                    </Option>
                  ))}
                </Select>
              </Space>
              <Space>
                <Button onClick={() => setSelectedDate(selectedDate.subtract(1, 'month'))}>
                  上个月
                </Button>
                <DatePicker
                  picker="month"
                  value={selectedDate}
                  onChange={(date) => date && setSelectedDate(date)}
                  allowClear={false}
                />
                <Button onClick={() => setSelectedDate(selectedDate.add(1, 'month'))}>
                  下个月
                </Button>
              </Space>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
                <div
                  key={day}
                  style={{
                    textAlign: 'center',
                    padding: '8px 0',
                    fontWeight: 'bold',
                    color: '#666',
                    background: '#fafafa',
                  }}
                >
                  {day}
                </div>
              ))}
              {calendarDays.map((date, index) => {
                const dayBookings = getBookingsForDay(date);
                return (
                  <div
                    key={index}
                    style={{
                      minHeight: 80,
                      padding: 4,
                      border: isSelected(date)
                        ? '2px solid #1890ff'
                        : '1px solid #f0f0f0',
                      background: date
                        ? isToday(date)
                          ? '#e6f7ff'
                          : '#fff'
                        : '#fafafa',
                      cursor: date ? 'pointer' : 'default',
                    }}
                    onClick={() => date && handleDateSelect(date)}
                  >
                    {date && (
                      <>
                        <div
                          style={{
                            fontWeight: isToday(date) ? 'bold' : 'normal',
                            color: isToday(date) ? '#1890ff' : '#333',
                            marginBottom: 4,
                          }}
                        >
                          {date.date()}
                        </div>
                        {dayBookings.slice(0, 2).map((booking) => (
                          <Tooltip
                            key={booking.id}
                            title={`${booking.start_time}-${booking.end_time} ${booking.venue_name} - ${booking.user_name}`}
                          >
                            <Tag
                              color={STATUS_COLOR[booking.status]}
                              style={{
                                fontSize: 11,
                                padding: '0 4px',
                                margin: 1,
                                maxWidth: '100%',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {booking.start_time}
                            </Tag>
                          </Tooltip>
                        ))}
                        {dayBookings.length > 2 && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            +{dayBookings.length - 2} 更多
                          </Text>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {Object.entries(STATUS_COLOR).map(([status, color]) => (
                <Tag key={status} color={color}>
                  {STATUS_TEXT[status as keyof typeof STATUS_TEXT]}
                </Tag>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card
            title={`${selectedDate.format('YYYY年MM月DD日')} 预约详情`}
            loading={loading}
          >
            {selectedVenueInfo && (
              <div style={{ marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
                <Text strong>
                  {selectedVenueInfo.code} - {selectedVenueInfo.name}
                </Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  容量: {selectedVenueInfo.capacity}人 · 押金: ¥{selectedVenueInfo.deposit_amount}
                </Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {selectedVenueInfo.description}
                </Text>
              </div>
            )}

            <List
              dataSource={getBookingsForDay(selectedDate)}
              locale={{ emptyText: '当日暂无预约' }}
              renderItem={(booking) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<ClockCircleOutlined />}
                    title={
                      <Space>
                        <Text strong>
                          {booking.start_time} - {booking.end_time}
                        </Text>
                        <Tag color={STATUS_COLOR[booking.status]}>
                          {STATUS_TEXT[booking.status]}
                        </Tag>
                      </Space>
                    }
                    description={
                      <div>
                        <Space>
                          <UserOutlined /> {booking.user_name}
                        </Space>
                        <br />
                        <Text type="secondary">押金: ¥{booking.deposit_amount}</Text>
                        {booking.purpose && (
                          <>
                            <br />
                            <Text type="secondary">用途: {booking.purpose}</Text>
                          </>
                        )}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title="提交预约申请"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={500}
      >
        <Form form={form} layout="vertical" onFinish={handleCreateBooking}>
          <Form.Item
            label="场地"
            name="venue"
          >
            <Select value={selectedVenueInfo ? `${selectedVenueInfo.code} - ${selectedVenueInfo.name}` : ''} disabled>
              {venues.map((v) => (
                <Option key={v.id} value={v.id}>
                  {v.code} - {v.name}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label="日期"
            name="date"
          >
            <Input value={selectedDate.format('YYYY-MM-DD')} disabled />
          </Form.Item>

          <Form.Item
            name="timeRange"
            label="时段"
            rules={[{ required: true, message: '请选择时段' }]}
          >
            <RangePicker
              format="HH:mm"
              minuteStep={30}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item
            name="purpose"
            label="使用用途"
            rules={[{ required: true, message: '请输入使用用途' }]}
          >
            <TextArea rows={3} placeholder="请描述使用用途" />
          </Form.Item>

          {selectedVenueInfo && (
            <div style={{ padding: 12, background: '#fffbe6', borderRadius: 4, marginBottom: 16 }}>
              <Text type="warning">
                提交后将冻结押金 ¥{selectedVenueInfo.deposit_amount}，
                当前余额: ¥{user?.balance?.toFixed(2) || '0.00'}
              </Text>
              {user && user.balance < selectedVenueInfo.deposit_amount && (
                <div style={{ color: '#ff4d4f', marginTop: 4 }}>
                  余额不足，请先充值
                </div>
              )}
            </div>
          )}

          <Form.Item style={{ marginBottom: 0 }}>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={checkingOverlap}
                disabled={user ? user.balance < (selectedVenueInfo?.deposit_amount || 0) : true}
              >
                提交申请
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
