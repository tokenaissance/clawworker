#!/usr/bin/env npx tsx
/**
 * 用户管理工具
 *
 * 用于管理本地数据库中的用户实例
 *
 * 使用方法：
 *   npm run manage-users                    # 交互式菜单
 *   npm run manage-users -- list            # 列出所有用户
 *   npm run manage-users -- show <email>    # 查看用户详情
 *   npm run manage-users -- create          # 创建新用户
 *   npm run manage-users -- delete <email>  # 删除用户
 *
 * 注意：AI 密钥和部署配置由部署脚本自动管理，此工具仅用于查询
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import * as path from 'path';
import * as readline from 'readline';
import * as crypto from 'crypto';

interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: number;
  image: string | null;
  createdAt: string;
  updatedAt: string;
  utmSource: string;
  ip: string;
  locale: string;
  gatewayToken: string | null;
}

interface AIProviderKey {
  id: number;
  userId: string;
  provider: string;
  baseUrl: string;
  keyHash: string;
  keyPrefix: string;
  apiKey: string | null;
  name: string;
  limitAmount: number;
  limitReset: string;
  disabled: number;
  createdAt: string;
}

interface DeploymentConfig {
  id: number;
  userId: string;
  cfAccessTeamDomain: string | null;
  cfAccessAud: string | null;
  r2AccessKeyId: string | null;
  r2SecretAccessKey: string | null;
  cfAccountId: string | null;
  sandboxSleepAfter: string;
  createdAt: string;
  updatedAt: string;
}

// 创建 readline 接口
function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

// 提示输入
async function prompt(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const displayQuestion = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(displayQuestion, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

// 确认提示
async function promptConfirm(rl: readline.Interface, question: string, defaultYes: boolean = false): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  return new Promise((resolve) => {
    rl.question(`${question} ${hint}: `, (answer) => {
      const normalized = answer.trim().toLowerCase();
      if (normalized === '') {
        resolve(defaultYes);
      } else {
        resolve(normalized === 'y' || normalized === 'yes');
      }
    });
  });
}

// 初始化数据库
function initDatabase(dbPath: string): DatabaseType {
  const db = new Database(dbPath);

  // 确保所有表都存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER DEFAULT 0,
      image TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      utmSource TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      locale TEXT DEFAULT '',
      gatewayToken TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_provider_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'openrouter',
      baseUrl TEXT NOT NULL,
      keyHash TEXT NOT NULL,
      keyPrefix TEXT,
      apiKey TEXT,
      name TEXT,
      limitAmount INTEGER,
      limitReset TEXT,
      disabled INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_userId ON ai_provider_keys(userId)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ai_provider_keys_provider ON ai_provider_keys(provider)
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_deployment_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL UNIQUE,
      cfAccessTeamDomain TEXT,
      cfAccessAud TEXT,
      r2AccessKeyId TEXT,
      r2SecretAccessKey TEXT,
      cfAccountId TEXT,
      sandboxSleepAfter TEXT DEFAULT 'never',
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  return db;
}

// 列出所有用户
function listUsers(db: DatabaseType): void {
  const users = db.prepare('SELECT * FROM users ORDER BY createdAt DESC').all() as User[];

  if (users.length === 0) {
    console.log('\n暂无用户');
    return;
  }

  console.log('\n' + '='.repeat(100));
  console.log('用户列表');
  console.log('='.repeat(100));
  console.log(
    'ID'.padEnd(38) +
    '邮箱'.padEnd(30) +
    '名称'.padEnd(20) +
    '创建时间'
  );
  console.log('-'.repeat(100));

  for (const user of users) {
    const createdAt = new Date(user.createdAt).toLocaleString('zh-CN');
    console.log(
      user.id.padEnd(38) +
      user.email.padEnd(30) +
      user.name.padEnd(20) +
      createdAt
    );
  }

  console.log('-'.repeat(100));
  console.log(`共 ${users.length} 个用户\n`);
}

// 查看用户详情
function showUser(db: DatabaseType, email: string): void {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;

  if (!user) {
    console.log(`\n❌ 未找到用户: ${email}`);
    return;
  }

  console.log('\n' + '='.repeat(80));
  console.log('用户详情');
  console.log('='.repeat(80));
  console.log(`ID:              ${user.id}`);
  console.log(`邮箱:            ${user.email}`);
  console.log(`名称:            ${user.name}`);
  console.log(`邮箱验证:        ${user.emailVerified ? '是' : '否'}`);
  console.log(`语言:            ${user.locale || '未设置'}`);
  console.log(`获客渠道:        ${user.utmSource || '未设置'}`);
  console.log(`Gateway Token:   ${user.gatewayToken || '未设置'}`);
  console.log(`创建时间:        ${new Date(user.createdAt).toLocaleString('zh-CN')}`);
  console.log(`更新时间:        ${new Date(user.updatedAt).toLocaleString('zh-CN')}`);

  // AI 提供商密钥
  const keys = db.prepare('SELECT * FROM ai_provider_keys WHERE userId = ?').all(user.id) as AIProviderKey[];
  console.log('\n' + '-'.repeat(80));
  console.log('AI 提供商密钥');
  console.log('-'.repeat(80));

  if (keys.length === 0) {
    console.log('暂无密钥');
  } else {
    for (const key of keys) {
      console.log(`\n提供商:          ${key.provider}`);
      console.log(`Base URL:        ${key.baseUrl}`);
      console.log(`密钥前缀:        ${key.keyPrefix}`);
      console.log(`名称:            ${key.name}`);
      console.log(`额度限制:        ${key.limitAmount} cents ($${(key.limitAmount / 100).toFixed(2)})`);
      console.log(`重置周期:        ${key.limitReset}`);
      console.log(`状态:            ${key.disabled ? '已禁用' : '启用'}`);
      console.log(`创建时间:        ${new Date(key.createdAt).toLocaleString('zh-CN')}`);
      if (key.apiKey) {
        console.log(`API Key:         ${key.apiKey}`);
      }
    }
  }

  // 部署配置
  const config = db.prepare('SELECT * FROM user_deployment_configs WHERE userId = ?').get(user.id) as DeploymentConfig | undefined;
  console.log('\n' + '-'.repeat(80));
  console.log('部署配置');
  console.log('-'.repeat(80));

  if (!config) {
    console.log('暂无配置');
  } else {
    console.log(`CF Access 域名:  ${config.cfAccessTeamDomain || '未设置'}`);
    console.log(`CF Access AUD:   ${config.cfAccessAud || '未设置'}`);
    console.log(`R2 Key ID:       ${config.r2AccessKeyId || '未设置'}`);
    console.log(`R2 Secret:       ${config.r2SecretAccessKey || '未设置'}`);
    console.log(`CF Account ID:   ${config.cfAccountId || '未设置'}`);
    console.log(`容器休眠时间:    ${config.sandboxSleepAfter}`);
    console.log(`创建时间:        ${new Date(config.createdAt).toLocaleString('zh-CN')}`);
    console.log(`更新时间:        ${new Date(config.updatedAt).toLocaleString('zh-CN')}`);
  }

  console.log('='.repeat(80) + '\n');
}

// 创建用户
async function createUser(db: DatabaseType, rl: readline.Interface): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('创建新用户');
  console.log('='.repeat(80));

  const email = await prompt(rl, '邮箱');
  if (!email) {
    console.log('❌ 邮箱不能为空');
    return;
  }

  // 检查邮箱是否已存在
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    console.log(`❌ 邮箱已存在: ${email}`);
    return;
  }

  const name = await prompt(rl, '名称');
  if (!name) {
    console.log('❌ 名称不能为空');
    return;
  }

  const locale = await prompt(rl, '语言', 'zh');
  const utmSource = await prompt(rl, '获客渠道（可选）', '');

  const userId = crypto.randomUUID();
  const gatewayToken = crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt, utmSource, locale, gatewayToken)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(userId, name, email, now, now, utmSource, locale, gatewayToken);

  console.log('\n✅ 用户创建成功！');
  console.log(`用户 ID:         ${userId}`);
  console.log(`Gateway Token:   ${gatewayToken}`);
  console.log(`\n请妥善保存 Gateway Token，它将用于访问 Worker。\n`);
}

// 更新用户
async function updateUser(db: DatabaseType, email: string, rl: readline.Interface): Promise<void> {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;

  if (!user) {
    console.log(`\n❌ 未找到用户: ${email}`);
    return;
  }

  console.log('\n' + '='.repeat(80));
  console.log('更新用户信息');
  console.log('='.repeat(80));
  console.log('提示：直接按回车保持原值不变\n');

  const name = await prompt(rl, '名称', user.name);
  const locale = await prompt(rl, '语言', user.locale);
  const utmSource = await prompt(rl, '获客渠道', user.utmSource);

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE users
    SET name = ?, locale = ?, utmSource = ?, updatedAt = ?
    WHERE email = ?
  `).run(name, locale, utmSource, now, email);

  console.log('\n✅ 用户信息已更新\n');
}

// 删除用户
async function deleteUser(db: DatabaseType, email: string, rl: readline.Interface): Promise<void> {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;

  if (!user) {
    console.log(`\n❌ 未找到用户: ${email}`);
    return;
  }

  console.log('\n' + '='.repeat(80));
  console.log('删除用户');
  console.log('='.repeat(80));
  console.log(`用户 ID:   ${user.id}`);
  console.log(`邮箱:      ${user.email}`);
  console.log(`名称:      ${user.name}`);
  console.log('='.repeat(80));

  const confirm = await promptConfirm(rl, '\n⚠️  确定要删除此用户吗？此操作不可恢复！', false);

  if (!confirm) {
    console.log('已取消删除\n');
    return;
  }

  // 删除关联数据
  db.prepare('DELETE FROM ai_provider_keys WHERE userId = ?').run(user.id);
  db.prepare('DELETE FROM user_deployment_configs WHERE userId = ?').run(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

  console.log('\n✅ 用户及其所有关联数据已删除\n');
}

// 管理 AI 密钥
async function manageAIKeys(db: DatabaseType, email: string, rl: readline.Interface): Promise<void> {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;

  if (!user) {
    console.log(`\n❌ 未找到用户: ${email}`);
    return;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`管理 AI 密钥 - ${user.name} (${user.email})`);
  console.log('='.repeat(80));

  const provider = await prompt(rl, 'AI 提供商 (openrouter/openai/anthropic/cloudflare-gateway)', 'openrouter');
  const baseUrl = await prompt(rl, 'Base URL',
    provider === 'openrouter' ? 'https://openrouter.ai/api/v1' :
    provider === 'openai' ? 'https://api.openai.com/v1' :
    provider === 'anthropic' ? 'https://api.anthropic.com' : ''
  );
  const apiKey = await prompt(rl, 'API Key');

  if (!apiKey) {
    console.log('❌ API Key 不能为空');
    return;
  }

  const keyPrefix = apiKey.slice(0, 12) + '...';
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const limitAmount = parseInt(await prompt(rl, '额度限制（美分）', '500'), 10);
  const limitReset = await prompt(rl, '重置周期 (daily/weekly/monthly)', 'monthly');

  // 检查是否已存在该提供商的密钥
  const existing = db.prepare(
    'SELECT id FROM ai_provider_keys WHERE userId = ? AND provider = ? AND disabled = 0'
  ).get(user.id, provider);

  if (existing) {
    const update = await promptConfirm(rl, `已存在 ${provider} 密钥，是否更新？`, true);
    if (update) {
      db.prepare(`
        UPDATE ai_provider_keys
        SET baseUrl = ?, keyHash = ?, keyPrefix = ?, apiKey = ?, limitAmount = ?, limitReset = ?
        WHERE userId = ? AND provider = ?
      `).run(baseUrl, keyHash, keyPrefix, apiKey, limitAmount, limitReset, user.id, provider);
      console.log('\n✅ AI 密钥已更新\n');
    }
  } else {
    db.prepare(`
      INSERT INTO ai_provider_keys (userId, provider, baseUrl, keyHash, keyPrefix, apiKey, name, limitAmount, limitReset, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(user.id, provider, baseUrl, keyHash, keyPrefix, apiKey, email, limitAmount, limitReset);
    console.log('\n✅ AI 密钥已添加\n');
  }
}

// 管理部署配置
async function manageDeploymentConfig(db: DatabaseType, email: string, rl: readline.Interface): Promise<void> {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;

  if (!user) {
    console.log(`\n❌ 未找到用户: ${email}`);
    return;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`管理部署配置 - ${user.name} (${user.email})`);
  console.log('='.repeat(80));

  const existing = db.prepare('SELECT * FROM user_deployment_configs WHERE userId = ?').get(user.id) as DeploymentConfig | undefined;

  console.log('提示：直接按回车跳过该项\n');

  const cfAccessTeamDomain = await prompt(rl, 'CF Access 团队域名', existing?.cfAccessTeamDomain || '');
  const cfAccessAud = await prompt(rl, 'CF Access AUD', existing?.cfAccessAud || '');
  const r2AccessKeyId = await prompt(rl, 'R2 Access Key ID', existing?.r2AccessKeyId || '');
  const r2SecretAccessKey = await prompt(rl, 'R2 Secret Access Key', existing?.r2SecretAccessKey || '');
  const cfAccountId = await prompt(rl, 'CF Account ID', existing?.cfAccountId || '');
  const sandboxSleepAfter = await prompt(rl, '容器休眠时间 (e.g., 10m, 1h, never)', existing?.sandboxSleepAfter || 'never');

  const now = new Date().toISOString();

  if (existing) {
    db.prepare(`
      UPDATE user_deployment_configs
      SET cfAccessTeamDomain = ?, cfAccessAud = ?, r2AccessKeyId = ?, r2SecretAccessKey = ?,
          cfAccountId = ?, sandboxSleepAfter = ?, updatedAt = ?
      WHERE userId = ?
    `).run(cfAccessTeamDomain, cfAccessAud, r2AccessKeyId, r2SecretAccessKey, cfAccountId, sandboxSleepAfter, now, user.id);
    console.log('\n✅ 部署配置已更新\n');
  } else {
    db.prepare(`
      INSERT INTO user_deployment_configs
      (userId, cfAccessTeamDomain, cfAccessAud, r2AccessKeyId, r2SecretAccessKey, cfAccountId, sandboxSleepAfter, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, cfAccessTeamDomain, cfAccessAud, r2AccessKeyId, r2SecretAccessKey, cfAccountId, sandboxSleepAfter, now, now);
    console.log('\n✅ 部署配置已创建\n');
  }
}

// 查询数据表
async function queryTables(db: DatabaseType, rl: readline.Interface): Promise<void> {
  while (true) {
    console.log('\n' + '='.repeat(80));
    console.log('数据表查询');
    console.log('='.repeat(80));
    console.log('1. 用户表 (users)');
    console.log('2. AI 提供商密钥表 (ai_provider_keys)');
    console.log('3. 部署配置表 (user_deployment_configs)');
    console.log('4. 查询所有表');
    console.log('0. 返回主菜单');
    console.log('='.repeat(80));

    const choice = await prompt(rl, '请选择要查询的表');

    switch (choice) {
      case '1': {
        const users = db.prepare('SELECT * FROM users ORDER BY createdAt DESC').all() as User[];
        console.log('\n【用户表 (users)】');
        console.log(`共 ${users.length} 条记录\n`);
        if (users.length > 0) {
          console.log(JSON.stringify(users, null, 2));
        } else {
          console.log('暂无数据');
        }
        break;
      }

      case '2': {
        const aiKeys = db.prepare('SELECT * FROM ai_provider_keys ORDER BY createdAt DESC').all() as AIProviderKey[];
        console.log('\n【AI 提供商密钥表 (ai_provider_keys)】');
        console.log(`共 ${aiKeys.length} 条记录\n`);
        if (aiKeys.length > 0) {
          console.log(JSON.stringify(aiKeys, null, 2));
        } else {
          console.log('暂无数据');
        }
        break;
      }

      case '3': {
        const deployConfigs = db.prepare('SELECT * FROM user_deployment_configs ORDER BY createdAt DESC').all() as DeploymentConfig[];
        console.log('\n【部署配置表 (user_deployment_configs)】');
        console.log(`共 ${deployConfigs.length} 条记录\n`);
        if (deployConfigs.length > 0) {
          console.log(JSON.stringify(deployConfigs, null, 2));
        } else {
          console.log('暂无数据');
        }
        break;
      }

      case '4': {
        // 查询所有表
        const users = db.prepare('SELECT * FROM users ORDER BY createdAt DESC').all() as User[];
        console.log('\n' + '='.repeat(100));
        console.log('【用户表 (users)】');
        console.log(`共 ${users.length} 条记录\n`);
        if (users.length > 0) {
          console.log(JSON.stringify(users, null, 2));
        }

        const aiKeys = db.prepare('SELECT * FROM ai_provider_keys ORDER BY createdAt DESC').all() as AIProviderKey[];
        console.log('\n' + '-'.repeat(100));
        console.log('【AI 提供商密钥表 (ai_provider_keys)】');
        console.log(`共 ${aiKeys.length} 条记录\n`);
        if (aiKeys.length > 0) {
          console.log(JSON.stringify(aiKeys, null, 2));
        }

        const deployConfigs = db.prepare('SELECT * FROM user_deployment_configs ORDER BY createdAt DESC').all() as DeploymentConfig[];
        console.log('\n' + '-'.repeat(100));
        console.log('【部署配置表 (user_deployment_configs)】');
        console.log(`共 ${deployConfigs.length} 条记录\n`);
        if (deployConfigs.length > 0) {
          console.log(JSON.stringify(deployConfigs, null, 2));
        }
        console.log('\n' + '='.repeat(100));
        break;
      }

      case '0':
        return;

      default:
        console.log('\n❌ 无效的选择\n');
    }
  }
}

// 交互式菜单
async function interactiveMenu(db: DatabaseType): Promise<void> {
  const rl = createReadline();

  while (true) {
    console.log('\n' + '='.repeat(80));
    console.log('用户管理工具');
    console.log('='.repeat(80));
    console.log('1. 列出所有用户');
    console.log('2. 查看用户详情');
    console.log('3. 创建新用户');
    console.log('4. 删除用户');
    console.log('5. 查询数据表');
    console.log('0. 退出');
    console.log('='.repeat(80));

    const choice = await prompt(rl, '请选择操作');

    switch (choice) {
      case '1':
        listUsers(db);
        break;

      case '2': {
        const email = await prompt(rl, '请输入用户邮箱');
        if (email) showUser(db, email);
        break;
      }

      case '3':
        await createUser(db, rl);
        break;

      case '4': {
        const email = await prompt(rl, '请输入用户邮箱');
        if (email) await deleteUser(db, email, rl);
        break;
      }

      case '5':
        await queryTables(db, rl);
        break;

      case '0':
        console.log('\n再见！\n');
        rl.close();
        return;

      default:
        console.log('\n❌ 无效的选择\n');
    }
  }
}

// 主函数
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  const dbPath = path.join(process.cwd(), 'users.db');
  console.log(`[DB] 数据库路径: ${dbPath}`);
  const db = initDatabase(dbPath);

  try {
    if (!command || command === 'menu') {
      await interactiveMenu(db);
    } else if (command === 'list') {
      listUsers(db);
    } else if (command === 'show') {
      const email = args[1];
      if (!email) {
        console.log('❌ 请提供用户邮箱');
        process.exit(1);
      }
      showUser(db, email);
    } else if (command === 'create') {
      const rl = createReadline();
      await createUser(db, rl);
      rl.close();
    } else if (command === 'delete') {
      const email = args[1];
      if (!email) {
        console.log('❌ 请提供用户邮箱');
        process.exit(1);
      }
      const rl = createReadline();
      await deleteUser(db, email, rl);
      rl.close();
    } else {
      console.log('❌ 未知命令:', command);
      console.log('\n可用命令:');
      console.log('  menu          - 交互式菜单（默认）');
      console.log('  list          - 列出所有用户');
      console.log('  show <email>  - 查看用户详情');
      console.log('  create        - 创建新用户');
      console.log('  delete <email> - 删除用户');
      process.exit(1);
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error('错误:', error);
  process.exit(1);
});
