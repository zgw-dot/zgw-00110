import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db, { initDatabase } from './database';

async function seed() {
  await initDatabase();

  const adminId = uuidv4();
  const resident1Id = uuidv4();
  const resident2Id = uuidv4();

  const adminPassword = await bcrypt.hash('admin123', 10);
  const residentPassword = await bcrypt.hash('user123', 10);

  try {
    await db.run(`
      INSERT INTO users (id, username, name, role, password_hash, balance)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [adminId, 'admin', '系统管理员', 'admin', adminPassword, 0]);
    console.log('创建管理员账号: admin / admin123');
  } catch (e) {
    console.log('管理员账号已存在');
  }

  try {
    await db.run(`
      INSERT INTO users (id, username, name, role, password_hash, balance)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [resident1Id, 'zhangsan', '张三', 'resident', residentPassword, 1000]);
    console.log('创建居民账号: zhangsan / user123, 余额: 1000元');
  } catch (e) {
    console.log('居民账号 zhangsan 已存在');
  }

  try {
    await db.run(`
      INSERT INTO users (id, username, name, role, password_hash, balance)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [resident2Id, 'lisi', '李四', 'resident', residentPassword, 500]);
    console.log('创建居民账号: lisi / user123, 余额: 500元');
  } catch (e) {
    console.log('居民账号 lisi 已存在');
  }

  const venues = [
    { id: uuidv4(), code: 'MULTI-001', name: '多功能厅', description: '可用于举办会议、晚会等大型活动', capacity: 200, deposit: 200 },
    { id: uuidv4(), code: 'GYM-001', name: '健身房', description: '配备专业健身器材', capacity: 30, deposit: 50 },
    { id: uuidv4(), code: 'MEET-001', name: '会议室A', description: '小型会议室，可容纳20人', capacity: 20, deposit: 100 },
    { id: uuidv4(), code: 'MEET-002', name: '会议室B', description: '中型会议室，可容纳50人', capacity: 50, deposit: 150 },
    { id: uuidv4(), code: 'TENNIS-001', name: '网球场', description: '标准网球场地', capacity: 4, deposit: 100 },
    { id: uuidv4(), code: 'BASKET-001', name: '篮球场', description: '标准篮球场地', capacity: 20, deposit: 150 },
    { id: uuidv4(), code: 'POOL-001', name: '乒乓球室', description: '室内乒乓球场地', capacity: 8, deposit: 50 },
    { id: uuidv4(), code: 'READ-001', name: '阅览室', description: '安静的阅读空间', capacity: 40, deposit: 0 },
  ];

  let venueCount = 0;
  for (const venue of venues) {
    try {
      await db.run(`
        INSERT INTO venues (id, code, name, description, capacity, deposit_amount, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `, [venue.id, venue.code, venue.name, venue.description, venue.capacity, venue.deposit]);
      venueCount++;
    } catch (e) {
      console.log(`场地 ${venue.code} 已存在`);
    }
  }

  console.log(`\n种子数据初始化完成!`);
  console.log(`新增场地: ${venueCount} 个`);
  console.log('\n默认账号:');
  console.log('  管理员: admin / admin123');
  console.log('  居民1:  zhangsan / user123 (余额1000元)');
  console.log('  居民2:  lisi / user123 (余额500元)');
}

seed().catch(console.error);
