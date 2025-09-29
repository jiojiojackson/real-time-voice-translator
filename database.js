import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class Database {
  constructor() {
    this.dbPath = join(__dirname, 'voice_translator.db');
    this.db = null;
  }

  async init() {
    const SQL = await initSqlJs();
    
    // 如果数据库文件存在，加载它
    if (existsSync(this.dbPath)) {
      const filebuffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(filebuffer);
    } else {
      // 创建新数据库
      this.db = new SQL.Database();
    }

    // 创建表
    this.createTables();
  }

  createTables() {
    // 创建对话历史表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        original_text TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        source_language TEXT,
        target_language TEXT,
        audio_duration REAL
      )
    `);

    // 创建设置表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // 保存数据库到文件
    this.saveToFile();
  }

  saveToFile() {
    if (this.db) {
      const data = this.db.export();
      writeFileSync(this.dbPath, data);
    }
  }

  // 保存对话记录
  saveConversation(originalText, translatedText, sourceLang = 'auto', targetLang = 'zh', duration = 0) {
    try {
      // 使用本地时间戳，确保与前端显示一致
      const now = new Date();
      const localTimestamp = now.getFullYear() + '-' + 
        String(now.getMonth() + 1).padStart(2, '0') + '-' + 
        String(now.getDate()).padStart(2, '0') + ' ' + 
        String(now.getHours()).padStart(2, '0') + ':' + 
        String(now.getMinutes()).padStart(2, '0') + ':' + 
        String(now.getSeconds()).padStart(2, '0');
      
      const stmt = this.db.prepare(`
        INSERT INTO conversations (timestamp, original_text, translated_text, source_language, target_language, audio_duration)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run([localTimestamp, originalText, translatedText, sourceLang, targetLang, duration]);
      stmt.free();
      
      // 保存到文件
      this.saveToFile();
      
      return Promise.resolve(result.insertId || this.db.exec("SELECT last_insert_rowid()")[0].values[0][0]);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // 获取对话历史
  getConversations(limit = 50) {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM conversations 
        ORDER BY timestamp DESC 
        LIMIT ?
      `);
      
      stmt.bind([limit]);
      const rows = [];
      
      // 获取所有行
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      
      stmt.free();
      return Promise.resolve(rows);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // 保存设置
  saveSetting(key, value) {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
      `);
      
      stmt.run([key, value]);
      stmt.free();
      
      // 保存到文件
      this.saveToFile();
      
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // 获取设置
  getSetting(key) {
    try {
      const stmt = this.db.prepare(`
        SELECT value FROM settings WHERE key = ?
      `);
      
      stmt.bind([key]);
      const hasRow = stmt.step();
      
      if (hasRow) {
        const row = stmt.getAsObject();
        stmt.free();
        return Promise.resolve(row.value);
      } else {
        stmt.free();
        return Promise.resolve(null);
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }

  // 关闭数据库连接
  close() {
    if (this.db) {
      this.saveToFile();
      this.db.close();
    }
  }
}

export default Database;