import React, { useState, useEffect } from 'react';
import { Layout as AntLayout, Menu, Avatar, Dropdown, Badge, Typography } from 'antd';
import {
  HomeOutlined,
  CalendarOutlined,
  ScheduleOutlined,
  BankOutlined,
  FileTextOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
  TeamOutlined,
  BellOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { bookingApi } from '../services/api';

const { Header, Sider, Content } = AntLayout;
const { Title, Text } = Typography;

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (user?.role === 'admin') {
      loadPendingCount();
      const interval = setInterval(loadPendingCount, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const loadPendingCount = async () => {
    try {
      const counts = await bookingApi.getPendingCount();
      setPendingCount(counts.pending);
    } catch (err) {
      console.error(err);
    }
  };

  const residentItems = [
    {
      key: '/',
      icon: <HomeOutlined />,
      label: '首页',
    },
    {
      key: '/calendar',
      icon: <CalendarOutlined />,
      label: '场地日历',
    },
    {
      key: '/bookings',
      icon: <ScheduleOutlined />,
      label: '我的预约',
    },
    {
      key: '/transactions',
      icon: <BankOutlined />,
      label: '押金账本',
    },
  ];

  const adminItems = [
    {
      key: '/',
      icon: <HomeOutlined />,
      label: '首页',
    },
    {
      key: '/calendar',
      icon: <CalendarOutlined />,
      label: '场地日历',
    },
    {
      key: '/bookings',
      icon: (
        <Badge count={pendingCount} size="small">
          <ScheduleOutlined />
        </Badge>
      ),
      label: '预约管理',
    },
    {
      key: '/venues',
      icon: <SettingOutlined />,
      label: '场地管理',
    },
    {
      key: '/transactions',
      icon: <BankOutlined />,
      label: '押金账本',
    },
    {
      key: '/users',
      icon: <TeamOutlined />,
      label: '用户管理',
    },
    {
      key: '/audit',
      icon: <FileTextOutlined />,
      label: '审计日志',
    },
  ];

  const menuItems = user?.role === 'admin' ? adminItems : residentItems;

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const userMenu = {
    items: [
      {
        key: '1',
        icon: <UserOutlined />,
        label: `${user?.name} (${user?.role === 'admin' ? '管理员' : '居民'})`,
        disabled: true,
      },
      {
        key: '2',
        icon: <BankOutlined />,
        label: `余额: ¥${user?.balance?.toFixed(2) || '0.00'}`,
        disabled: true,
      },
      { type: 'divider' },
      {
        key: '3',
        icon: <LogoutOutlined />,
        label: '退出登录',
        onClick: handleLogout,
      },
    ],
  };

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          background: '#fff',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Title level={4} style={{ margin: 0, color: '#1890ff' }}>
            社区场地预约与押金核销系统
          </Title>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {user?.role === 'admin' && pendingCount > 0 && (
            <Badge count={pendingCount} showZero={false}>
              <BellOutlined style={{ fontSize: 20, color: '#666' }} />
            </Badge>
          )}
          <Dropdown menu={userMenu} placement="bottomRight">
            <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} style={{ marginRight: 8 }} />
              <Text>{user?.name}</Text>
            </div>
          </Dropdown>
        </div>
      </Header>
      <AntLayout>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={220}
          style={{
            background: '#001529',
          }}
        >
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={handleMenuClick}
            style={{ height: '100%', borderRight: 0 }}
          />
        </Sider>
        <Content
          style={{
            margin: '24px',
            padding: '24px',
            background: '#fff',
            borderRadius: 8,
            minHeight: 280,
          }}
        >
          {children}
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
