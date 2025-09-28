import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class Database {
  constructor() {
    this.db = new sqlite3.Database(join(__dirname, 'voice_translator.db'));
    this.init();
  }

  init() {
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
  }

  // 保存对话记录
  saveConversation(originalText, translatedText, sourceLang = 'auto', targetLang = 'zh', duration = 0) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO conversations (original_text, translated_text, source_language, target_language, audio_duration)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      stmt.run([originalText, translatedText, sourceLang, targetLang, duration], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
      
      stmt.finalize();
    });
  }

  // 获取对话历史
  getConversations(limit = 50) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM conversations 
        ORDER BY timestamp DESC 
        LIMIT ?
      `, [limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  // 保存设置
  saveSetting(key, value) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)
      `, [key, value], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // 获取设置
  getSetting(key) {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT value FROM settings WHERE key = ?
      `, [key], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row ? row.value : null);
        }
      });
    });
  }

  // 关闭数据库连接
  close() {
    this.db.close();
  }
}

export default Database;