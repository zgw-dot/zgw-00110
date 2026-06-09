# 社区场地预约与押金核销系统

一套完整的、可本地启动的前后端项目，支持社区场地预约、押金冻结与核销、审批流程、审计日志等功能。

## 技术栈

- **前端**: Vite + React 18 + TypeScript + Ant Design
- **后端**: Express + TypeScript + SQLite
- **数据库**: SQLite (本地文件存储，支持 WAL 模式保证数据一致性)
- **认证**: JWT + BCrypt

## 功能特性

### 居民功能
- 查看场地日历，了解场地占用情况
- 提交时段预约申请，系统自动冻结相应押金
- 查看预约状态和历史记录
- 取消待审批的预约
- 查看个人押金账本和余额变化明细

### 管理员功能
- 审批预约申请（通过/拒绝）
- 签到管理（到场确认）
- 核销完成（使用完成后退还押金）
- 标记爽约（未到场扣除押金）
- 场地管理（增删改查 + CSV 导入导出）
- 预约 CSV 导出
- 用户管理和充值
- 审计日志查看

### 核心特性
- **严格状态流转**: pending → approved → checked_in → completed
  支持取消、拒绝、爽约等分支状态
- **核销语义说明**:
  - 核销 = 确认正常使用完成，押金作为保证金退还
  - 爽约 = 未到场，押金作为违约金扣除
  - 状态流转说明中，completed = 核销完成（押金退还），no_show = 爽约（押金扣除）
- **余额安全**: 所有余额变更使用数据库事务，失败自动回滚
- **防重预约**: 自动检测时段重叠，拒绝重复预约
- **操作审计**: 所有操作记录审计日志，可追溯
- **账本追踪**: 每笔余额变化关联预约单据，余额前后值可查
- **数据持久化**: SQLite 本地文件存储，重启后数据完全一致
- **CSV 导入导出**: 支持场地批量导入，重复编号自动报告
- **首页待办**: 自动提示待审批、待签到等待处理事项

## 快速启动

### 前置要求
- Node.js >= 18.x
- npm >= 9.x

### 安装依赖

```bash
# 安装根目录、前端和后端的所有依赖
npm run install:all
```

### 初始化数据库（可选，首次启动自动执行）

数据库会在首次启动时自动初始化并创建种子数据。如果需要手动初始化：

```bash
cd server
npm run seed
```

### 启动开发模式

```bash
# 同时启动前端和后端
npm run dev

# 或者分别启动
npm run dev:server  # 后端: http://localhost:3001
npm run dev:client  # 前端: http://localhost:5173
```

### 生产模式

```bash
# 构建
npm run build

# 启动
npm start
```

访问 http://localhost:3001 即可使用系统。

## 角色账号

系统预置以下测试账号：

| 角色   | 用户名   | 密码     | 初始余额 |
|--------|----------|----------|----------|
| 管理员 | admin    | admin123 | -        |
| 居民   | zhangsan | user123  | ¥1000.00 |
| 居民   | lisi     | user123  | ¥500.00  |

## 预约状态流转图

```
                    ┌──────────────────────────┐
                    │  pending                 │ (待审批)
                    │  [deposit_freeze 冻结]   │
                    └──────────┬───────────────┘
                               │
          ┌────────────────────┼────────────────────────┐
          ▼                    ▼                        ▼
    ┌───────────┐   ┌──────────────────────┐   ┌──────────────────────┐
    │ approved  │   │ rejected             │   │ cancelled            │
    └─────┬─────┘   │ [deposit_refund 退还]│   │ [deposit_refund 退还]│
          │         └──────────────────────┘   └──────────────────────┘
  ┌───────┼──────────────────┐
  ▼       ▼                  ▼
┌──────────┐ ┌──────┐ ┌──────────────────────┐
│checked_in│ │cancel│ │ no_show              │
└────┬─────┘ └──────┘ │ [deposit_deduct 扣除]│
     │                └──────────────────────┘
     ▼
┌──────────────────────────┐
│ completed                │ (已核销)
│ [deposit_refund 退还]    │
└──────────────────────────┘
```

## 三条验证步骤

### 验证步骤一：主流程 - 预约到核销

**目的**: 验证完整的预约-审批-签到-核销流程

**操作步骤**:
1. 使用居民账号 `zhangsan` 登录（密码: user123）
2. 进入「场地日历」页面，选择一个空闲场地和时段创建预约
3. 确认押金被冻结，查看「押金账本」确认有 `deposit_freeze` 记录，余额减少相应金额
4. 退出登录，使用管理员账号 `admin` 登录（密码: admin123）
5. 首页「待处理事项」会显示待审批预约提醒
6. 进入「预约管理」，找到刚创建的预约，点击「通过」
7. 预约状态变为 `approved`（已通过）
8. 点击「签到」，状态变为 `checked_in`（已签到）
9. 点击「核销」，状态变为 `completed`（已核销）
10. 查看「押金账本」，确认有 `deposit_refund` 记录，冻结的押金正式退还

**预期结果**:
- 预约状态正确流转: pending → approved → checked_in → completed
- 余额变化正确: 冻结时余额减少，核销时押金从冻结状态转为正式退还
- 每一步都有操作历史记录和审计日志

---

### 验证步骤二：非法路径测试 - 失败不改余额

**目的**: 验证非法操作不会修改余额，系统防护有效

**非法路径测试清单**:

| 测试场景 | 操作方式 | 预期结果 |
|----------|----------|----------|
| **重叠时段审批** | 管理员审批一个与已通过预约时间重叠的预约 | 审批失败，提示时段冲突，余额不变 |
| **居民直接核销** | 居民账号调用核销接口或尝试核销按钮 | 无权限，提示需要管理员操作，余额不变 |
| **押金不足预约** | 余额 ¥100，预约需押金 ¥200 | 预约失败，提示余额不足，余额不变 |
| **取消已核销记录** | 尝试取消状态为 `completed` 的预约 | 操作失败，提示状态不允许，余额不变 |
| **非本人取消** | 居民 A 尝试取消居民 B 的预约 | 操作失败，提示无权限，余额不变 |

**验证余额不变的方法**:
1. 操作前查看用户当前余额，记录为 `balance_before`
2. 执行非法操作，确认操作失败
3. 刷新页面或重新查询余额，确认余额仍为 `balance_before`
4. 查看「押金账本」，确认没有新增交易记录

---

### 验证步骤三：数据一致性 - 重启后保持一致

**目的**: 验证系统重启后日历、押金账本、审计日志保持一致

**操作步骤**:
1. 按照步骤一完成一次完整的预约到核销流程
2. 记录以下信息:
   - 日历视图中各预约的状态和位置
   - 某用户的当前余额
   - 押金账本的最后 3 条记录
   - 审计日志的最后 5 条记录
3. 停止服务（Ctrl+C）
4. 等待 10 秒
5. 重新启动服务 `npm run dev`
6. 分别使用居民和管理员账号登录
7. 对比以下内容与重启前是否一致:
   - 「场地日历」: 所有预约的状态、时间、场地都应保持不变
   - 「押金账本」: 所有交易记录、余额前后值、关联单据都应保持不变
   - 「审计日志」: 所有操作记录、操作人、时间、详情都应保持不变
   - 用户余额: 重启前后完全一致

**预期结果**:
- 所有数据在重启后完全一致，无丢失、无错乱
- 数据库文件 `server/data/venue-booking.db` 完整保存了所有数据

## CSV 导入导出说明

### 场地 CSV 格式

| 字段     | 类型    | 必填 | 说明                     |
|----------|---------|------|--------------------------|
| code     | string  | 是   | 场地编号，唯一           |
| name     | string  | 是   | 场地名称                 |
| capacity | number  | 是   | 容纳人数                 |
| deposit  | number  | 是   | 押金金额（元）           |
| description | string | 否 | 场地描述                 |
| active   | boolean | 否   | 是否启用，默认 true      |

### 导入重复检测

- 导入时会检测 CSV 文件内的重复编号
- 会检测与系统中已存在的场地编号冲突
- 重复的场地编号会在结果中明确报告，未重复的正常导入

### 示例 CSV 内容

```csv
code,name,capacity,deposit,description
V001,多功能厅,50,100,可用于会议、培训
V002,健身房,20,50,24小时开放
V003,乒乓球室,4,30,提供球拍
```

## 项目结构

```
zgw-00110/
├── client/                 # 前端项目
│   ├── src/
│   │   ├── components/     # 公共组件
│   │   ├── contexts/       # React Context
│   │   ├── pages/          # 页面组件
│   │   ├── services/       # API 服务
│   │   ├── types.ts        # 类型定义
│   │   ├── App.tsx         # 路由配置
│   │   └── main.tsx        # 入口文件
│   ├── package.json
│   └── vite.config.ts
├── server/                 # 后端项目
│   ├── src/
│   │   ├── middleware/     # 中间件
│   │   ├── routes/         # API 路由
│   │   ├── services/       # 业务逻辑
│   │   ├── types.ts        # 类型定义
│   │   ├── config.ts       # 配置
│   │   ├── database.ts     # 数据库初始化
│   │   ├── seed.ts         # 种子数据
│   │   └── index.ts        # 入口文件
│   ├── data/               # 数据库文件目录
│   └── package.json
├── package.json            # 根目录配置
└── README.md
```

## API 接口清单

### 认证接口
- `POST /api/auth/login` - 登录
- `GET /api/auth/me` - 获取当前用户
- `GET /api/auth/users` - 获取用户列表（管理员）
- `POST /api/auth/users` - 创建用户（管理员）
- `POST /api/auth/users/:id/recharge` - 用户充值（管理员）

### 场地接口
- `GET /api/venues` - 获取场地列表
- `POST /api/venues` - 创建场地（管理员）
- `PUT /api/venues/:id` - 更新场地（管理员）
- `DELETE /api/venues/:id` - 删除场地（管理员）
- `POST /api/venues/import` - CSV 导入场地（管理员）
- `GET /api/venues/export/csv` - CSV 导出场地

### 预约接口
- `GET /api/bookings` - 获取预约列表
- `POST /api/bookings` - 创建预约
- `GET /api/bookings/calendar` - 获取日历视图数据
- `GET /api/bookings/pending-count` - 待处理数量
- `POST /api/bookings/:id/approve` - 审批通过（管理员）
- `POST /api/bookings/:id/reject` - 拒绝（管理员）
- `POST /api/bookings/:id/checkin` - 签到（管理员）
- `POST /api/bookings/:id/complete` - 核销（管理员）
- `POST /api/bookings/:id/cancel` - 取消
- `POST /api/bookings/:id/noshow` - 标记爽约（管理员）
- `GET /api/bookings/:id/history` - 状态历史
- `GET /api/bookings/export/csv` - CSV 导出预约

### 交易接口
- `GET /api/transactions` - 获取本人交易记录
- `GET /api/transactions/all` - 获取所有交易记录（管理员）
- `GET /api/transactions/balance` - 获取当前余额

### 审计接口
- `GET /api/audit` - 获取审计日志（管理员）

## 数据库表结构

### users
- id, username, password_hash, name, role, balance, created_at

### venues
- id, code, name, capacity, deposit, description, active, created_at

### bookings
- id, user_id, venue_id, start_time, end_time, status, deposit_amount, purpose, created_at

### transactions
- id, user_id, booking_id, type, amount, balance_before, balance_after, description, created_at

### audit_logs
- id, user_id, user_name, action, booking_id, details, ip_address, created_at

### booking_histories
- id, booking_id, old_status, new_status, changed_by, changed_by_name, reason, created_at

## 安全设计

1. **密码安全**: 使用 BCrypt 哈希存储密码
2. **认证**: JWT Token，无状态认证
3. **授权**: 基于角色的访问控制（RBAC），每个接口都有权限校验
4. **SQL 注入防护**: 使用参数化查询（better-sqlite3 预编译语句）
5. **余额安全**:
   - 所有余额变更使用数据库事务
   - 变更前校验余额充足性
   - 每笔交易记录 `balance_before` 和 `balance_after`
   - 失败自动回滚，绝不修改余额
6. **XSS 防护**: 前端使用 React 自动转义
7. **输入校验**: 所有接口参数进行类型和格式校验

## 常见问题

### Q: 数据库文件在哪里？
A: `server/data/venue-booking.db`，删除此文件即可重置数据库。

### Q: 如何重置为初始数据？
A: 删除 `server/data/venue-booking.db`，然后重启服务，数据库会自动重建并加载种子数据。

### Q: 前端和后端端口分别是多少？
A: 开发模式下前端 5173，后端 3001；生产模式下统一使用 3001 端口。

### Q: 如何修改 JWT 密钥？
A: 修改 `server/src/config.ts` 中的 `JWT_SECRET`。
