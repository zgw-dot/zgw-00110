import React, { useState, useEffect } from 'react';
import {
  Table,
  Button,
  Space,
  Tag,
  Typography,
  Card,
  Select,
  InputNumber,
  Modal,
  Form,
  message,
  Statistic,
  Row,
  Col,
} from 'antd';
import {
  BankOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  UserOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { transactionApi, authApi } from '../services/api';
import {
  Transaction,
  TRANSACTION_TEXT,
  TRANSACTION_COLOR,
  User,
} from '../types';

const { Title, Text } = Typography;
const { Option } = Select;

export default function Transactions() {
  const { user, refreshUser } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [userIdFilter, setUserIdFilter] = useState<string>('');
  const [users, setUsers] = useState<User[]>([]);
  const [rechargeModalVisible, setRechargeModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [rechargeForm] = Form.useForm();

  useEffect(() => {
    loadTransactions();
    if (user?.role === 'admin') {
      loadUsers();
    }
  }, [page, pageSize, userIdFilter, user]);

  const loadTransactions = async () => {
    setLoading(true);
    try {
      let result;
      if (user?.role === 'admin') {
        if (userIdFilter) {
          result = await transactionApi.getUserTransactions(userIdFilter, page, pageSize);
        } else {
          result = await transactionApi.getAllTransactions(page, pageSize);
        }
      } else {
        result = await transactionApi.getMyTransactions(page, pageSize);
      }
      setTransactions(result.transactions);
      setTotal(result.total);
    } catch (err) {
      message.error('加载交易记录失败');
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

  const handleRecharge = async (values: any) => {
    if (!selectedUser) return;
    try {
      await authApi.recharge(selectedUser.id, values.amount);
      message.success('充值成功');
      setRechargeModalVisible(false);
      rechargeForm.resetFields();
      loadTransactions();
      refreshUser();
      if (user?.role === 'admin') {
        loadUsers();
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '充值失败');
    }
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
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => (
        <Tag color={TRANSACTION_COLOR[type as keyof typeof TRANSACTION_COLOR]}>
          {TRANSACTION_TEXT[type as keyof typeof TRANSACTION_TEXT]}
        </Tag>
      ),
    },
    {
      title: '用户',
      dataIndex: 'user_name',
      key: 'user_name',
      hidden: user?.role !== 'admin',
    },
    {
      title: '相关场地',
      dataIndex: 'venue_name',
      key: 'venue_name',
      render: (text: string, record: Transaction) => {
        if (text) {
          return (
            <div>
              <Text>{text}</Text>
              {record.booking_date && (
                <>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {record.booking_date}
                  </Text>
                </>
              )}
            </div>
          );
        }
        return '-';
      },
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      render: (val: number, record: Transaction) => {
        const isIncome = ['deposit_release', 'deposit_refund', 'deposit_recharge'].includes(record.type);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isIncome ? 
            <ArrowDownOutlined style={{ color: '#52c41a' }} />
            : 
            <ArrowUpOutlined style={{ color: '#ff4d4f' }} />
          }
          <Text strong style={{ color: isIncome ? '#52c41a' : '#ff4d4f' }}>
            {isIncome ? '+' : '-'}¥{val.toFixed(2)}
          </Text>
          </div>
        );
      },
    },
    {
      title: '变动前',
      dataIndex: 'balance_before',
      key: 'balance_before',
      width: 100,
      render: (val: number) => `¥${val.toFixed(2)}`,
    },
    {
      title: '变动后',
      dataIndex: 'balance_after',
      key: 'balance_after',
      width: 100,
      render: (val: number) => `¥${val.toFixed(2)}`,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
  ];

  const filteredColumns = columns.filter((col: any) => !col.hidden);

  const incomeTotal = transactions
    .filter((t) => ['deposit_release', 'deposit_refund', 'deposit_recharge'].includes(t.type))
    .reduce((sum, t) => sum + t.amount, 0);

  const expenseTotal = transactions
    .filter((t) => ['deposit_freeze', 'deposit_deduct'].includes(t.type))
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <BankOutlined /> 押金账本
        </Title>
        {user?.role === 'admin' && (
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            onClick={() => {
              setSelectedUser(null);
              rechargeForm.resetFields();
              setRechargeModalVisible(true);
            }}
          >
            给用户充值
          </Button>
        )}
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic
              title="当前余额"
              value={user?.balance || 0}
              precision={2}
              prefix="¥"
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic
              title="收入合计"
              value={incomeTotal}
              precision={2}
              prefix="¥"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic
              title="支出合计"
              value={expenseTotal}
              precision={2}
              prefix="¥"
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic
              title="交易笔数"
              value={total}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
      </Row>

      {user?.role === 'admin' && (
        <Card style={{ marginBottom: 16 }}>
          <Space>
            <Select
              style={{ width: 200 }}
              placeholder="筛选用户"
              allowClear
              value={userIdFilter || undefined}
              onChange={(val) => {
                setUserIdFilter(val || '');
                setPage(1);
              }}
            >
              {users.map((u) => (
                <Option key={u.id} value={u.id}>
                  {u.name} ({u.username}) - 余额: ¥{u.balance.toFixed(2)}
                </Option>
              ))}
            </Select>
            <Button onClick={loadTransactions} type="primary">
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
      )}

      <Table
        loading={loading}
        dataSource={transactions}
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

      <Modal
        title="用户充值"
        open={rechargeModalVisible}
        onCancel={() => setRechargeModalVisible(false)}
        footer={null}
        width={400}
      >
        <Form form={rechargeForm} layout="vertical" onFinish={handleRecharge}>
          {user?.role === 'admin' && (
            <Form.Item
              name="userId"
              label="选择用户"
              rules={[{ required: true, message: '请选择用户' }]}
            >
              <Select
                placeholder="请选择用户"
                onChange={(val) => {
                  const u = users.find((usr) => usr.id === val);
                  setSelectedUser(u || null);
                }}
              >
                {users.map((u) => (
                  <Option key={u.id} value={u.id}>
                    {u.name} ({u.username}) - 当前余额: ¥{u.balance.toFixed(2)}
                  </Option>
                ))}
              </Select>
            </Form.Item>
          )}

          <Form.Item
            name="amount"
            label="充值金额"
            rules={[
              { required: true, message: '请输入充值金额' },
              { type: 'number', min: 0.01, message: '金额必须大于0' },
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={2}
              placeholder="请输入金额"
              prefix="¥"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setRechargeModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">
                确认充值
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
