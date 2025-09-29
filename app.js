import dotenv from 'dotenv';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import VoiceService from './voice-service.js';
import Database from './database.js';
import { upload } from './audio-upload.js';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// 加载环境变量
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class VoiceTranslatorApp {
  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this.db = null; // 稍后初始化
    this.voiceService = null; // 稍后初始化
    this.clients = new Set();
  }

  async init() {
    await this.initializeDatabase();
    await this.initializeVoiceService();
    this.setupExpress();
    this.setupWebSocket();
    this.setupVoiceService();
  }

  async initializeDatabase() {
    try {
      this.db = new Database();
      await this.db.init(); // 确保数据库初始化完成
      console.log('数据库初始化完成');
    } catch (error) {
      console.error('数据库初始化错误:', error);
      throw error;
    }
  }

  async initializeVoiceService() {
    try {
      // 优先使用数据库中保存的 API Key
      const savedApiKey = await this.db.getSetting('groq_api_key');
      const apiKey = savedApiKey || process.env.GROQ_API_KEY;

      this.voiceService = new VoiceService(apiKey);
      console.log('VoiceService 初始化完成，API Key 来源:', savedApiKey ? '数据库' : '环境变量');
    } catch (error) {
      console.error('初始化 VoiceService 错误:', error);
      // 如果出错，使用环境变量作为后备
      this.voiceService = new VoiceService(process.env.GROQ_API_KEY);
    }
  }

  setupExpress() {
    this.app.use(express.static(join(__dirname, 'public')));
    this.app.use(express.json());

    // API 路由
    this.app.get('/api/history', async (req, res) => {
      try {
        const conversations = await this.db.getConversations();
        res.json(conversations);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/settings', async (req, res) => {
      try {
        const { key, value } = req.body;
        await this.db.saveSetting(key, value);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/settings/:key', async (req, res) => {
      try {
        const value = await this.db.getSetting(req.params.key);
        res.json({ value });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // API Key 设置
    this.app.post('/api/set-api-key', async (req, res) => {
      try {
        const { apiKey } = req.body;

        if (!apiKey || apiKey.trim() === '') {
          return res.status(400).json({ error: 'API Key 不能为空' });
        }

        // 更新 VoiceService 的 API Key
        this.voiceService.updateApiKey(apiKey.trim());

        // 保存到数据库
        await this.db.saveSetting('groq_api_key', apiKey.trim());

        res.json({ success: true, message: 'API Key 设置成功' });
      } catch (error) {
        console.error('设置 API Key 错误:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // 获取当前 API Key 状态
    this.app.get('/api/api-key-status', async (req, res) => {
      try {
        const savedKey = await this.db.getSetting('groq_api_key');
        const hasKey = !!(savedKey || process.env.GROQ_API_KEY);
        const keySource = savedKey ? 'database' : (process.env.GROQ_API_KEY ? 'env' : 'none');

        res.json({
          hasKey,
          keySource,
          keyPreview: hasKey ? '***' + (savedKey || process.env.GROQ_API_KEY).slice(-4) : null
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // 音频文件上传和转录
    this.app.post('/api/upload-audio', upload.single('audio'), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: '没有上传音频文件' });
        }

        let audioPath = req.file.path;
        const sourceLanguage = req.body.sourceLanguage || null;
        const targetLanguage = req.body.targetLanguage || 'zh';
        const sessionId = req.body.sessionId || Date.now().toString();
        const segmentId = req.body.segmentId || null;
        const isSegment = req.body.isSegment === 'true';

        // Groq Whisper API 支持多种格式，包括 WebM
        console.log('处理音频文件:', req.file.originalname, '格式:', req.file.mimetype);
        console.log('源语言:', sourceLanguage || '自动检测', '目标语言:', targetLanguage);

        if (isSegment && segmentId) {
          console.log('智能分段模式 - 分段ID:', segmentId);

          // 使用智能分段处理
          this.processAudioSegmentAsync(audioPath, sourceLanguage, targetLanguage, sessionId, segmentId);
        } else {
          // 传统处理方式
          this.processAudioAsync(audioPath, sourceLanguage, targetLanguage, sessionId, req.file.originalname);
        }

        // 立即返回处理中状态
        res.json({
          status: 'processing',
          sessionId: sessionId,
          segmentId: segmentId,
          message: isSegment ? '正在处理音频分段...' : '正在处理音频...'
        });

      } catch (error) {
        console.error('音频处理错误:', error);
        // 清理临时文件
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: error.message });
      }
    });

    // 新增：仅翻译文本的API
    this.app.post('/api/translate-text', async (req, res) => {
      try {
        const { text, targetLanguage = 'zh', sessionId } = req.body;

        if (!text) {
          return res.status(400).json({ error: '缺少要翻译的文本' });
        }

        // 异步翻译
        this.translateTextAsync(text, targetLanguage, sessionId);

        res.json({
          status: 'translating',
          sessionId: sessionId,
          message: '正在翻译...'
        });

      } catch (error) {
        console.error('翻译错误:', error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      console.log('新的WebSocket连接');
      this.clients.add(ws);

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);

          switch (data.type) {
            case 'translate':
              const sessionId = data.sessionId || `ws-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

              // 异步翻译
              this.translateTextAsync(
                data.text,
                data.targetLanguage || 'zh',
                sessionId
              );

              // 立即返回处理中状态
              ws.send(JSON.stringify({
                type: 'translationProcessing',
                sessionId: sessionId,
                message: '正在翻译...'
              }));
              break;
          }
        } catch (error) {
          console.error('WebSocket消息处理错误:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: error.message
          }));
        }
      });

      ws.on('close', () => {
        console.log('WebSocket连接关闭');
        this.clients.delete(ws);
      });
    });
  }

  setupVoiceService() {
    this.voiceService.on('error', (error) => {
      this.broadcast({
        type: 'error',
        message: error.message
      });
    });

    // 监听智能分段事件
    this.voiceService.on('segmentTranscribed', (data) => {
      console.log(`[${data.sessionId}] 分段转录完成: ${data.segmentId}`);
      this.broadcast({
        type: 'segmentTranscribed',
        sessionId: data.sessionId,
        segmentId: data.segmentId,
        originalText: data.originalText,
        detectedLanguage: data.detectedLanguage,
        timestamp: data.timestamp
      });
    });

    this.voiceService.on('segmentTranslated', (data) => {
      console.log(`[${data.sessionId}] 分段翻译完成: ${data.segmentId}`);
      this.broadcast({
        type: 'segmentTranslated',
        sessionId: data.sessionId,
        segmentId: data.segmentId,
        originalText: data.originalText,
        translatedText: data.translatedText,
        sourceLanguage: data.sourceLanguage,
        targetLanguage: data.targetLanguage,
        timestamp: data.timestamp
      });

      // 异步保存到数据库
      this.saveConversationAsync(
        data.originalText,
        data.translatedText,
        data.sourceLanguage,
        data.targetLanguage,
        data.sessionId
      );
    });

    this.voiceService.on('segmentError', (data) => {
      console.error(`[${data.sessionId}] 分段处理错误: ${data.segmentId} - ${data.error}`);
      this.broadcast({
        type: 'segmentError',
        sessionId: data.sessionId,
        segmentId: data.segmentId,
        error: data.error,
        errorType: data.type
      });
    });
  }

  // 异步处理音频转录和翻译
  async processAudioAsync(audioPath, sourceLanguage, targetLanguage, sessionId, originalName) {
    try {
      // 第一步：转录音频
      console.log(`[${sessionId}] 开始转录音频...`);
      const transcription = await this.voiceService.transcribeAudio(audioPath, sourceLanguage);

      // 立即广播转录结果
      this.broadcast({
        type: 'transcriptionComplete',
        sessionId: sessionId,
        original: transcription.text,
        sourceLanguage: transcription.language,
        targetLanguage: targetLanguage
      });

      console.log(`[${sessionId}] 转录完成，开始翻译...`);

      // 第二步：异步翻译文本
      const translation = await this.voiceService.translateText(
        transcription.text,
        targetLanguage
      );

      // 广播翻译结果
      this.broadcast({
        type: 'translationComplete',
        sessionId: sessionId,
        original: transcription.text,
        translated: translation,
        sourceLanguage: transcription.language,
        targetLanguage: targetLanguage
      });

      // 异步保存到数据库
      this.saveConversationAsync(
        transcription.text,
        translation,
        transcription.language,
        targetLanguage,
        sessionId
      );

      console.log(`[${sessionId}] 处理完成`);

      // 删除临时文件
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }

    } catch (error) {
      console.error(`[${sessionId}] 音频处理错误:`, error);

      // 广播错误信息
      this.broadcast({
        type: 'processingError',
        sessionId: sessionId,
        error: error.message
      });

      // 清理临时文件
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
    }
  }

  // 异步翻译文本
  async translateTextAsync(text, targetLanguage, sessionId) {
    try {
      console.log(`[${sessionId}] 开始翻译文本...`);

      const translation = await this.voiceService.translateText(text, targetLanguage);

      // 广播翻译结果
      this.broadcast({
        type: 'translationComplete',
        sessionId: sessionId,
        original: text,
        translated: translation,
        targetLanguage: targetLanguage
      });

      // 异步保存到数据库
      this.saveConversationAsync(
        text,
        translation,
        'manual', // 手动输入的源语言标记
        targetLanguage,
        sessionId
      );

      console.log(`[${sessionId}] 翻译完成`);

    } catch (error) {
      console.error(`[${sessionId}] 翻译错误:`, error);

      // 广播错误信息
      this.broadcast({
        type: 'processingError',
        sessionId: sessionId,
        error: error.message
      });
    }
  }

  // 智能分段音频处理
  async processAudioSegmentAsync(audioPath, sourceLanguage, targetLanguage, sessionId, segmentId) {
    try {
      console.log(`[${sessionId}] 开始处理音频分段 ${segmentId}...`);

      // 直接使用文件路径进行处理，避免 Blob 转换
      // 使用智能分段处理 - 传递文件路径而不是 Blob
      this.voiceService.addAudioSegmentFromFile(
        audioPath,
        sessionId,
        segmentId,
        sourceLanguage,
        targetLanguage
      );

      console.log(`[${sessionId}] 分段 ${segmentId} 已加入处理队列`);

    } catch (error) {
      console.error(`[${sessionId}] 分段处理错误:`, error);

      // 广播错误信息
      this.broadcast({
        type: 'segmentError',
        sessionId: sessionId,
        segmentId: segmentId,
        error: error.message,
        errorType: 'processing'
      });

      // 清理临时文件
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }
    }
  }

  // 异步保存对话到数据库
  async saveConversationAsync(originalText, translatedText, sourceLanguage, targetLanguage, sessionId) {
    try {
      console.log(`[${sessionId}] 保存对话到数据库...`);

      await this.db.saveConversation(
        originalText,
        translatedText,
        sourceLanguage,
        targetLanguage
      );

      console.log(`[${sessionId}] 对话已保存到数据库`);

    } catch (error) {
      console.error(`[${sessionId}] 数据库保存错误:`, error);
      // 数据库保存失败不影响用户体验，只记录错误
    }
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    });
  }

  start(port = 3000) {
    this.server.listen(port, () => {
      console.log(`语音翻译应用启动在端口 ${port}`);
      console.log(`访问 http://localhost:${port} 开始使用`);
    });
  }

  stop() {
    this.db.close();
    this.server.close();
  }
}

// 启动应用
let appInstance = null;

async function startApp() {
  try {
    appInstance = new VoiceTranslatorApp();
    await appInstance.init();
    appInstance.start();
  } catch (error) {
    console.error('应用启动失败:', error);
    process.exit(1);
  }
}

startApp();

// 优雅关闭
process.on('SIGINT', () => {
  console.log('正在关闭应用...');
  if (appInstance) {
    appInstance.stop();
  }
  process.exit(0);
});

export default VoiceTranslatorApp;