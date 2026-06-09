import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, List, Tag, Button, Typography, Space, Alert } from 'antd';
import {
  CalendarOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  TeamOutlined,
  BankOutlined,
  FileTextOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { bookingApi, venueApi, transactionApi } from '../services/api';
import { STATUS_TEXT, STATUS_COLOR, Booking } from '../types';
import { useNavigate } from 'react-router-dom';

const { Title, Text } = Typography;

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>({});
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [pendingActions, setPendingActions] = useState<any[]>([]);

  useEffect(() => {
    loadData();
    refreshUser();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [bookingsResult, venuesResult, counts] = await Promise.all([
        bookingApi.getBookings({ pageSize: 5 }),
        venueApi.getVenues(),
        bookingApi.getPendingCount(),
      ]);

      setRecentBookings(bookingsResult.bookings);

      if (user?.role === 'admin') {
        setStats({
          totalVenues: venuesResult.length,
          pendingApproval: counts.pending,
          inUse: counts.checkedIn,
          approved: counts.approved,
          pendingReschedule: counts.pendingReschedule,
        });

        const actions: any[] = [];
        if (counts.pending > 0) {
          actions.push({
            type: 'warning',
            title: '待审批预约',
            count: counts.pending,
            description: `有 ${counts.pending} 个预约等待审批`,
            action: () => navigate('/bookings?status=pending'),
          });
        }
        if (counts.pendingReschedule > 0) {
          actions.push({
            type: 'warning',
            title: '待处理改期',
            count: counts.pendingReschedule,
            description: `有 ${counts.pendingReschedule} 个改期申请等待处理`,
            action: () => navigate('/bookings?tab=reschedules'),
          });
        }
        if (counts.approved > 0) {
          actions.push({
            type: 'info',
            title: '待签到预约',
            count: counts.approved,
            description: `有 ${counts.approved} 个预约等待签到`,
            action: () => navigate('/bookings?status=approved'),
          });
        }
        if (counts.checkedIn > 0) {
          actions.push({
            type: 'success',
            title: '使用中场次',
            count: counts.checkedIn,
            description: `有 ${counts.checkedIn} 个场地正在使用中`,
            action: () => navigate('/bookings?status=checked_in'),
          });
        }
        setPendingActions(actions);
      } else {
        const myBookings = bookingsResult.bookings;
        const myPending = myBookings.filter((b) => b.status === 'pending').length;
        const myApproved = myBookings.filter((b) => b.status === 'approved').length;
        const myCompleted = myBookings.filter((b) => b.status === 'completed').length;

        setStats({
          myBookings: bookingsResult.total,
          myPending,
          myApproved,
          myCompleted,
        });

        const actions: any[] = [];
        if (myPending > 0) {
          actions.push({
            type: 'warning',
            title: '待审批',
            count: myPending,
            description: `您有 ${myPending} 个预约正在等待审批`,
            action: () => navigate('/bookings?status=pending'),
          });
        }
        if (myApproved > 0) {
          actions.push({
            type: 'info',
            title: '已批准',
            count: myApproved,
            description: `您有 ${myApproved} 个预约已批准，请按时使用`,
            action: () => navigate('/bookings?status=approved'),
          });
        }
        setPendingActions(actions);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const adminStats = [
    {
      title: '场地总数',
      value: stats.totalVenues || 0,
      icon: <CalendarOutlined style={{ color: '#1890ff', fontSize: 30 }} />,
      color: '#1890ff',
    },
    {
      title: '待审批预约',
      value: stats.pendingApproval || 0,
      icon: <ClockCircleOutlined style={{ color: '#faad14', fontSize: 30 }} />,
      color: '#faad14',
    },
    {
      title: '使用中',
      value: stats.inUse || 0,
      icon: <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 30 }} />,
      color: '#52c41a',
    },
    {
      title: '已批准待签到',
      value: stats.approved || 0,
      icon: <WarningOutlined style={{ color: '#722ed1', fontSize: 30 }} />,
      color: '#722ed1',
    },
  ];

  const residentStats = [
    {
      title: '我的预约',
      value: stats.myBookings || 0,
      icon: <FileTextOutlined style={{ color: '#1890ff', fontSize: 30 }} />,
      color: '#1890ff',
    },
    {
      title: '待审批',
      value: stats.myPending || 0,
      icon: <ClockCircleOutlined style={{ color: '#faad14', fontSize: 30 }} />,
      color: '#faad14',
    },
    {
      title: '已批准',
      value: stats.myApproved || 0,
      icon: <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 30 }} />,
      color: '#52c41a',
    },
    {
      title: '已完成',
      value: stats.myCompleted || 0,
      icon: <TeamOutlined style={{ color: '#722ed1', fontSize: 30 }} />,
      color: '#722ed1',
    },
  ];

  const currentStats = user?.role === 'admin' ? adminStats : residentStats;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ marginBottom: 8 }}>
          欢迎回来，{user?.name}！
        </Title>
        <Text type="secondary">
          {user?.role === 'admin' ? '管理员' : '居民'} 账户 · 当前余额：
          <Text strong style={{ color: '#52c41a' }}>
            {' '}
            ¥{user?.balance?.toFixed(2) || '0.00'}
          </Text>
        </Text>
      </div>

      {pendingActions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <Title level={5} style={{ marginBottom: 12 }}>
            待处理事项
          </Title>
          <Space direction="vertical" style={{ width: '100%' }}>
            {pendingActions.map((action, index) => (
              <Alert
                key={index}
                type={action.type as any}
                showIcon
                action={
                  <Button size="small" type="primary" ghost onClick={action.action}>
                    查看 <ArrowRightOutlined />
                  </Button>
                }
                message={
                  <Space>
                    <Text strong>{action.title}</Text>
                    <Tag color={action.type === 'warning' ? 'orange' : action.type === 'info' ? 'blue' : 'green'}>
                      {action.count} 项
                    </Tag>
                  </Space>
                }
                description={action.description}
              />
            ))}
          </Space>
        </div>
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {currentStats.map((stat, index) => (
          <Col xs={12} lg={6} key={index}>
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Statistic title={stat.title} value={stat.value} />
                {stat.icon}
              </div>
            </Card>
          </Col>
        ))}
        <Col xs={12} lg={6}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Statistic
                title={user?.role === 'admin' ? '账户余额' : '我的余额'}
                prefix="¥"
                value={user?.balance || 0}
                precision={2}
              />
              <BankOutlined style={{ color: '#fa8c16', fontSize: 30 }} />
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title="最近预约"
            extra={
              <Button type="link" onClick={() => navigate('/bookings')}>
                查看全部
              </Button>
            }
          >
            <List
              loading={loading}
              dataSource={recentBookings}
              renderItem={(booking) => (
                <List.Item
                  actions={[
                    <Tag color={STATUS_COLOR[booking.status]} key="status">
                      {STATUS_TEXT[booking.status]}
                    </Tag>,
                  ]}
                >
                  <List.Item.Meta
                    title={`${booking.venue_name} · ${booking.date}`}
                    description={`${booking.start_time} - ${booking.end_time} · ${booking.user_name || ''}`}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title="快捷操作"
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button type="primary" size="large" block onClick={() => navigate('/calendar')}>
                <CalendarOutlined /> 查看场地日历
              </Button>
              {user?.role === 'resident' && (
                <Button size="large" block onClick={() => navigate('/calendar')}>
                  <ClockCircleOutlined /> 提交预约申请
                </Button>
              )}
              {user?.role === 'admin' && (
                <>
                  <Button size="large" block onClick={() => navigate('/venues')}>
                    <FileTextOutlined /> 场地管理
                  </Button>
                  <Button size="large" block onClick={() => navigate('/transactions')}>
                    <BankOutlined /> 账本管理
                  </Button>
                </>
              )}
              <Button size="large" block onClick={() => navigate('/transactions')}>
                <BankOutlined /> 查看交易记录
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
