import React, { useState, useEffect } from 'react';
import {
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  message,
  Typography,
  Card,
} from 'antd';
import {
  PlusOutlined,
  TeamOutlined,
  UserOutlined,
  BankOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { authApi } from '../services/api';
import { User, UserRole } from '../types';

const { Title, Text } = Typography;
const { Option } = Select;

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await authApi.getUsers();
      setUsers(data);
    } catch (err) {
      message.error('加载用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      await authApi.createUser({
        username: values.username,
        password: values.password,
        name: values.name,
        role: values.role,
        initialBalance: values.initialBalance,
      });
      message.success('创建成功');
      setModalVisible(false);
      form.resetFields();
      loadUsers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '创建失败');
    }
  };

  const handleRecharge = async (user: User) => {
    Modal.confirm({
      title: `给 ${user.name} 充值`,
      content: (
        <div>
          <p>当前余额: ¥{user.balance.toFixed(2)}</p>
          <InputNumber
            id="recharge-amount"
            min={1}
            precision={2}
            defaultValue={100}
            style={{ width: '100%' }}
            placeholder="请输入充值金额"
            prefix="¥"
          />
        </div>
      ),
      okText: '确认充值',
      cancelText: '取消',
      onOk: async () => {
        const input = document.getElementById('recharge-amount') as HTMLInputElement;
        const amount = parseFloat(input.value);
        if (!amount || amount <= 0) {
          message.error('请输入有效的充值金额');
          return Promise.reject();
        }
        try {
          await authApi.recharge(user.id, amount);
          message.success('充值成功');
          loadUsers();
        } catch (err: any) {
          message.error(err.response?.data?.error || '充值失败');
          return Promise.reject();
        }
      },
    });
  };

  const columns = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: User) => (
        <Space>
          <UserOutlined />
          <Text strong>{text}</Text>
        </Space>
      ),
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: (role: UserRole) => (
        <Tag color={role === 'admin' ? 'blue' : 'green'}>
          {role === 'admin' ? '管理员' : '居民'}
        </Tag>
      ),
    },
    {
      title: '余额',
      dataIndex: 'balance',
      key: 'balance',
      width: 120,
      render: (val: number) => (
        <Text strong style={{ color: val > 0 ? '#52c41a' : '#ff4d4f' }}>
          ¥{val.toFixed(2)}
        </Text>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, record: User) => (
        <Button
          type="link"
          size="small"
          icon={<BankOutlined />}
          onClick={() => handleRecharge(record)}
        >
          充值
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <TeamOutlined /> 用户管理
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalVisible(true)}>
          新增用户
        </Button>
      </div>

      <Table
        loading={loading}
        dataSource={users}
        columns={columns}
        rowKey="id"
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title="新增用户"
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={500}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="姓名"
            rules={[{ required: true, message: '请输入姓名' }]}
          >
            <Input placeholder="请输入姓名" />
          </Form.Item>

          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>

          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select placeholder="请选择角色">
              <Option value="resident">居民</Option>
              <Option value="admin">管理员</Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="initialBalance"
            label="初始余额"
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={2}
              placeholder="请输入初始余额"
              prefix="¥"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">
                创建
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
