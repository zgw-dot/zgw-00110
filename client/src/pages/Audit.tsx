import React, { useState, useEffect } from 'react';
import {
  Table,
  Button,
  Space,
  Tag,
  Typography,
  Card,
  Select,
  message,
} from 'antd';
import {
  FileTextOutlined,
  UserOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { auditApi, authApi } from '../services/api';
import { AuditLog, User } from '../types';

const { Title, Text } = Typography;
const { Option } = Select;

export default function Audit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [userIdFilter, setUserIdFilter] = useState<string>('');
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    loadLogs();
    loadUsers();
  }, [page, pageSize, userIdFilter]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const result = await auditApi.getLogs(page, pageSize);
      setLogs(result.logs);
      setTotal(result.total);
    } catch (err) {
      message.error('加载审计日志失败');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await authApi.getUsers();
      setUsers(data);
    } catch (err) {
      console.error(err);
    }
  };

  const actionMap: Record<string, { text: string; color: string }> = {
    login: { text: '登录', color: 'blue' },
    create_booking: { text: '创建预约', color: 'cyan' },
    approve_booking: { text: '审批通过', color: 'green' },
    reject_booking: { text: '拒绝预约', color: 'red' },
    checkin_booking: { text: '签到', color: 'geekblue' },
    complete_booking: { text: '核销完成', color: 'success' },
    cancel_booking: { text: '取消预约', color: 'orange' },
    noshow_booking: { text: '标记爽约', color: 'magenta' },
    create_venue: { text: '创建场地', color: 'purple' },
    update_venue: { text: '更新场地', color: 'gold' },
    delete_venue: { text: '删除场地', color: 'red' },
    import_venues: { text: '导入场地', color: 'lime' },
    create_user: { text: '创建用户', color: 'blue' },
    recharge: { text: '充值', color: 'green' },
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 120,
      render: (action: string) => {
        const info = actionMap[action] || { text: action, color: 'default' };
        return <Tag color={info.color as any}>{info.text}</Tag>;
      },
    },
    {
      title: '操作人',
      dataIndex: 'user_name',
      key: 'user_name',
      width: 120,
      render: (text: string, record: AuditLog) => (
        <Space>
          <UserOutlined />
          <Text>{record.user_display_name || text}</Text>
        </Space>
      ),
    },
    {
      title: '关联预约',
      dataIndex: 'booking_id',
      key: 'booking_id',
      width: 100,
      render: (id: string | null) => (id ? id.slice(0, 8) + '...' : '-'),
    },
    {
      title: '详情',
      dataIndex: 'details',
      key: 'details',
      ellipsis: true,
    },
    {
      title: 'IP地址',
      dataIndex: 'ip_address',
      key: 'ip_address',
      width: 130,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <HistoryOutlined /> 审计日志
        </Title>
        <Button icon={<FileTextOutlined />} onClick={loadLogs}>
          刷新
        </Button>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Select
            style={{ width: 200 }}
            placeholder="筛选操作人"
            allowClear
            value={userIdFilter || undefined}
            onChange={(val) => {
              setUserIdFilter(val || '');
              setPage(1);
            }}
          >
            {users.map((u) => (
              <Option key={u.id} value={u.id}>
                {u.name} ({u.username})
              </Option>
            ))}
          </Select>
          <Button onClick={loadLogs} type="primary">
            查询
          </Button>
          <Button
            onClick={() => {
              setUserIdFilter('');
              setPage(1);
            }}
          >
            重置
          </Button>
        </Space>
      </Card>

      <Table
        loading={loading}
        dataSource={logs}
        columns={columns}
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
    </div>
  );
}
