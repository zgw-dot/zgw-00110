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
  Switch,
  message,
  Typography,
  Popconfirm,
  Card,
  Upload,
  Alert,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  UploadOutlined,
  DownloadOutlined,
  ImportOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { venueApi } from '../services/api';
import { Venue } from '../types';

const { Title, Text } = Typography;
const { TextArea } = Input;

export default function Venues() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);
  const [form] = Form.useForm();
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importContent, setImportContent] = useState('');

  useEffect(() => {
    loadVenues();
  }, []);

  const loadVenues = async () => {
    setLoading(true);
    try {
      const data = await venueApi.getVenues(true);
      setVenues(data);
    } catch (err) {
      message.error('加载场地列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingVenue(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (venue: Venue) => {
    setEditingVenue(venue);
    form.setFieldsValue({
      code: venue.code,
      name: venue.name,
      description: venue.description,
      capacity: venue.capacity,
      depositAmount: venue.deposit_amount,
      isActive: !!venue.is_active,
    });
    setModalVisible(true);
  };

  const handleSubmit = async (values: any) => {
    try {
      if (editingVenue) {
        await venueApi.updateVenue(editingVenue.id, {
          name: values.name,
          description: values.description,
          capacity: values.capacity,
          depositAmount: values.depositAmount,
          isActive: values.isActive ? 1 : 0,
        });
        message.success('更新成功');
      } else {
        await venueApi.createVenue({
          code: values.code,
          name: values.name,
          description: values.description,
          capacity: values.capacity,
          depositAmount: values.depositAmount,
        });
        message.success('创建成功');
      }
      setModalVisible(false);
      loadVenues();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await venueApi.deleteVenue(id);
      message.success('删除成功');
      loadVenues();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const handleToggleActive = async (venue: Venue, checked: boolean) => {
    try {
      await venueApi.updateVenue(venue.id, { isActive: checked ? 1 : 0 });
      message.success(checked ? '已启用' : '已停用');
      loadVenues();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const handleExport = async () => {
    try {
      const blob = await venueApi.exportVenues();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `venues_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch (err) {
      message.error('导出失败');
    }
  };

  const handleImport = async () => {
    if (!importContent.trim()) {
      message.error('请输入CSV内容');
      return;
    }
    try {
      const result = await venueApi.importVenues(importContent);
      setImportResult(result);
      loadVenues();
      if (result.success > 0) {
        message.success(`导入成功 ${result.success} 条`);
      }
      if (result.failed > 0) {
        message.error(`导入失败 ${result.failed} 条`);
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '导入失败');
    }
  };

  const columns = [
    {
      title: '编号',
      dataIndex: 'code',
      key: 'code',
      width: 120,
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '容量',
      dataIndex: 'capacity',
      key: 'capacity',
      width: 80,
      render: (val: number) => `${val}人`,
    },
    {
      title: '押金',
      dataIndex: 'deposit_amount',
      key: 'deposit_amount',
      width: 100,
      render: (val: number) => `¥${val.toFixed(2)}`,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (val: number, record: Venue) => (
        <Switch
          checked={!!val}
          onChange={(checked) => handleToggleActive(record, checked)}
          checkedChildren="启用"
          unCheckedChildren="停用"
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_: any, record: Venue) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除？"
            onConfirm={() => handleDelete(record.id)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <SettingOutlined /> 场地管理
        </Title>
        <Space>
          <Button icon={<ImportOutlined />} onClick={() => setImportModalVisible(true)}>
            导入CSV
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>
            导出CSV
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            新增场地
          </Button>
        </Space>
      </div>

      <Table
        loading={loading}
        dataSource={venues}
        columns={columns}
        rowKey="id"
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={editingVenue ? '编辑场地' : '新增场地'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={500}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="code"
            label="场地编号"
            rules={[{ required: true, message: '请输入场地编号' }]}
          >
            <Input disabled={!!editingVenue} placeholder="如：MULTI-001" />
          </Form.Item>

          <Form.Item
            name="name"
            label="场地名称"
            rules={[{ required: true, message: '请输入场地名称' }]}
          >
            <Input placeholder="如：多功能厅" />
          </Form.Item>

          <Form.Item
            name="description"
            label="场地描述"
          >
            <TextArea rows={3} placeholder="请输入场地描述" />
          </Form.Item>

          <Space style={{ width: '100%' }}>
            <Form.Item
              name="capacity"
              label="容量(人)"
              rules={[{ required: true, message: '请输入容量' }]}
              style={{ flex: 1 }}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item
              name="depositAmount"
              label="押金(元)"
              rules={[{ required: true, message: '请输入押金' }]}
              style={{ flex: 1 }}
            >
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          </Space>

          {editingVenue && (
            <Form.Item
              name="isActive"
              label="是否启用"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit">
                {editingVenue ? '保存' : '创建'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="导入场地CSV"
        open={importModalVisible}
        onCancel={() => {
          setImportModalVisible(false);
          setImportResult(null);
          setImportContent('');
        }}
        width={700}
        footer={[
          <Button
            key="submit"
            type="primary"
            onClick={handleImport}
            icon={<UploadOutlined />}
          >
            执行导入
          </Button>,
        ]}
      >
        <Alert
          message="CSV格式说明"
          description={
            <div>
              <p>CSV文件需要包含以下列：code, name, description, capacity, deposit_amount</p>
              <p>示例：</p>
              <pre style={{ background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
{`code,name,description,capacity,deposit_amount
MEET-003,小型会议室,可容纳10人,10,50
GYM-002,瑜伽室,专业瑜伽场地,20,100`}
              </pre>
            </div>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <TextArea
          rows={10}
          value={importContent}
          onChange={(e) => setImportContent(e.target.value)}
          placeholder="请粘贴CSV内容，或使用Excel打开后复制粘贴"
        />

        {importResult && (
          <Card style={{ marginTop: 16 }}>
            <Title level={5}>导入结果</Title>
            <Space>
              <Tag color="green">成功: {importResult.success}</Tag>
              <Tag color="red">失败: {importResult.failed}</Tag>
              {importResult.duplicates.length > 0 && (
                <Tag color="orange">
                  重复编号: {importResult.duplicates.join(', ')}
                </Tag>
              )}
            </Space>
            {importResult.errors.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Text type="danger">错误详情：</Text>
                <ul>
                  {importResult.errors.map((err: any, idx: number) => (
                    <li key={idx} style={{ color: '#ff4d4f', fontSize: 12 }}>
                      第{err.row}行 [{err.code}]: {err.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
      </Modal>
    </div>
  );
}
