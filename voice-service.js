import Groq from "groq-sdk";
import fs from "fs";
import { EventEmitter } from "events";

class VoiceService extends EventEmitter {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    this.groq = new Groq({ apiKey });
    
    // 智能分段处理队列
    this.transcriptionQueue = [];
    this.translationQueue = [];
    this.isProcessingTranscription = false;
    this.isProcessingTranslation = false;
    
    // 分段配置
    this.segmentConfig = {
      maxSegmentDuration: 30000, // 最大分段时长30秒
      minSegmentDuration: 1000,  // 最小分段时长1秒
      silenceThreshold: 0.01,    // 静音阈值
      pauseDetectionTime: 800,   // 停顿检测时间800ms
      maxConcurrentJobs: 3       // 最大并发处理数
    };
    
    // 活跃的处理任务
    this.activeTranscriptions = new Map();
    this.activeTranslations = new Map();
    
    this.startQueueProcessors();
  }

  // 转录音频
  async transcribeAudio(audioFile, sourceLanguage = null) {
    try {
      console.log('开始转录音频文件:', audioFile);

      const transcriptionParams = {
        file: fs.createReadStream(audioFile),
        model: "whisper-large-v3-turbo",
        response_format: "verbose_json"
      };

      // 如果指定了源语言，添加到参数中
      if (sourceLanguage && this.isSupportedLanguage(sourceLanguage)) {
        transcriptionParams.language = sourceLanguage;
        console.log('使用指定语言:', sourceLanguage);
      } else {
        console.log('使用自动语言检测');
      }

      const transcription = await this.groq.audio.transcriptions.create(transcriptionParams);

      console.log('转录完成:', transcription.text);

      return {
        text: transcription.text,
        language: transcription.language || 'unknown'
      };
    } catch (error) {
      console.error('转录错误:', error);
      throw error;
    }
  }

  // 检查是否为支持的语言代码
  isSupportedLanguage(languageCode) {
    const supportedLanguages = [
      'yo', 'tl', 'pt', 'sk', 'ka', 'ur', 'fa', 'kn', 'hy', 'sq', 'af', 'sd', 'ba', 'ca',
      'ml', 'bn', 'is', 'mr', 'oc', 'uz', 'fi', 'vi', 'no', 'th', 'sl', 'sw', 'tg', 'as',
      'hr', 'so', 'tk', 'en', 'he', 'ms', 'be', 'tr', 'nl', 'pa', 'yi', 'lo', 'bo', 'mg',
      'ko', 'cs', 'lt', 'sr', 'et', 'br', 'ne', 'mn', 'es', 'uk', 'gu', 'mt', 'my', 'yue',
      'fr', 'hi', 'el', 'te', 'ps', 'tt', 'ha', 'de', 'ja', 'ar', 'kk', 'su', 'pl', 'it',
      'ro', 'mk', 'am', 'nn', 'sa', 'lb', 'ta', 'fo', 'haw', 'jv', 'zh', 'id', 'bg', 'la',
      'mi', 'cy', 'eu', 'km', 'ru', 'da', 'az', 'sn', 'ht', 'ln', 'sv', 'hu', 'lv', 'bs',
      'gl', 'si'
    ];

    return supportedLanguages.includes(languageCode);
  }

  // 智能分段处理 - 添加音频分段到转录队列（从 Blob）
  addAudioSegment(audioBlob, sessionId, segmentId, sourceLanguage = null, targetLanguage = 'zh') {
    const segmentInfo = {
      id: segmentId,
      sessionId: sessionId,
      audioBlob: audioBlob,
      audioFilePath: null,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      timestamp: Date.now(),
      status: 'queued'
    };
    
    this.transcriptionQueue.push(segmentInfo);
    console.log(`[${sessionId}] 音频分段 ${segmentId} 已加入转录队列，队列长度: ${this.transcriptionQueue.length}`);
    
    // 触发队列处理
    this.processTranscriptionQueue();
    
    return segmentInfo;
  }

  // 智能分段处理 - 添加音频分段到转录队列（从文件路径）
  addAudioSegmentFromFile(audioFilePath, sessionId, segmentId, sourceLanguage = null, targetLanguage = 'zh') {
    const segmentInfo = {
      id: segmentId,
      sessionId: sessionId,
      audioBlob: null,
      audioFilePath: audioFilePath,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      timestamp: Date.now(),
      status: 'queued'
    };
    
    this.transcriptionQueue.push(segmentInfo);
    console.log(`[${sessionId}] 音频分段 ${segmentId} (文件) 已加入转录队列，队列长度: ${this.transcriptionQueue.length}`);
    
    // 触发队列处理
    this.processTranscriptionQueue();
    
    return segmentInfo;
  }

  // 启动队列处理器
  startQueueProcessors() {
    // 转录队列处理器
    setInterval(() => {
      if (!this.isProcessingTranscription && this.transcriptionQueue.length > 0) {
        this.processTranscriptionQueue();
      }
    }, 100);
    
    // 翻译队列处理器
    setInterval(() => {
      if (!this.isProcessingTranslation && this.translationQueue.length > 0) {
        this.processTranslationQueue();
      }
    }, 100);
  }

  // 处理转录队列
  async processTranscriptionQueue() {
    if (this.transcriptionQueue.length === 0) {
      return;
    }
    
    // 限制并发转录数量
    const activeCount = this.activeTranscriptions.size;
    if (activeCount >= this.segmentConfig.maxConcurrentJobs) {
      return;
    }
    
    const segment = this.transcriptionQueue.shift();
    if (!segment) {
      return;
    }
    
    // 标记为处理中
    segment.status = 'transcribing';
    this.activeTranscriptions.set(segment.id, segment);
    
    console.log(`[${segment.sessionId}] 开始转录分段 ${segment.id}...`);
    
    // 异步处理转录（不等待完成）
    this.transcribeSegmentAsync(segment).catch(error => {
      console.error(`转录分段 ${segment.id} 失败:`, error);
    });
  }

  // 异步转录分段
  async transcribeSegmentAsync(segment) {
    let tempFilePath = null;
    
    try {
      // 获取音频文件路径
      if (segment.audioFilePath) {
        // 直接使用文件路径
        tempFilePath = segment.audioFilePath;
      } else if (segment.audioBlob) {
        // 将 Blob 转换为临时文件
        tempFilePath = await this.blobToTempFile(segment.audioBlob, segment.id);
      } else {
        throw new Error('没有可用的音频数据');
      }
      
      // 转录音频
      const transcription = await this.transcribeAudio(tempFilePath, segment.sourceLanguage);
      
      // 清理临时文件（只清理从 Blob 创建的临时文件）
      if (segment.audioBlob && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      } else if (segment.audioFilePath && fs.existsSync(segment.audioFilePath)) {
        // 清理原始文件
        fs.unlinkSync(segment.audioFilePath);
      }
      
      // 移除活跃转录
      this.activeTranscriptions.delete(segment.id);
      
      // 发送转录完成事件
      this.emit('segmentTranscribed', {
        sessionId: segment.sessionId,
        segmentId: segment.id,
        originalText: transcription.text,
        detectedLanguage: transcription.language,
        timestamp: segment.timestamp
      });
      
      // 如果需要翻译，添加到翻译队列
      if (segment.targetLanguage && transcription.text.trim()) {
        this.addTranslationTask(
          transcription.text,
          segment.targetLanguage,
          segment.sessionId,
          segment.id,
          transcription.language
        );
      }
      
      console.log(`[${segment.sessionId}] 分段 ${segment.id} 转录完成: "${transcription.text}"`);
      
    } catch (error) {
      console.error(`[${segment.sessionId}] 分段 ${segment.id} 转录失败:`, error);
      
      // 清理临时文件
      if (segment.audioBlob && tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      } else if (segment.audioFilePath && fs.existsSync(segment.audioFilePath)) {
        fs.unlinkSync(segment.audioFilePath);
      }
      
      // 移除活跃转录
      this.activeTranscriptions.delete(segment.id);
      
      // 发送错误事件
      this.emit('segmentError', {
        sessionId: segment.sessionId,
        segmentId: segment.id,
        error: error.message,
        type: 'transcription'
      });
    }
  }

  // 添加翻译任务到队列
  addTranslationTask(text, targetLanguage, sessionId, segmentId, sourceLanguage) {
    const translationTask = {
      id: `${segmentId}_translation`,
      sessionId: sessionId,
      segmentId: segmentId,
      text: text,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      timestamp: Date.now(),
      status: 'queued'
    };
    
    this.translationQueue.push(translationTask);
    console.log(`[${sessionId}] 翻译任务 ${translationTask.id} 已加入队列，队列长度: ${this.translationQueue.length}`);
    
    // 立即触发翻译队列处理
    this.processTranslationQueue();
  }

  // 处理翻译队列
  async processTranslationQueue() {
    if (this.translationQueue.length === 0) {
      return;
    }
    
    // 限制并发翻译数量
    const activeCount = this.activeTranslations.size;
    if (activeCount >= this.segmentConfig.maxConcurrentJobs) {
      return;
    }
    
    const task = this.translationQueue.shift();
    if (!task) {
      return;
    }
    
    // 标记为处理中
    task.status = 'translating';
    this.activeTranslations.set(task.id, task);
    
    console.log(`[${task.sessionId}] 开始翻译分段 ${task.segmentId}...`);
    
    // 异步处理翻译（不等待完成）
    this.translateSegmentAsync(task).catch(error => {
      console.error(`翻译分段 ${task.segmentId} 失败:`, error);
    });
  }

  // 异步翻译分段
  async translateSegmentAsync(task) {
    try {
      const translation = await this.translateText(task.text, task.targetLanguage);
      
      // 移除活跃翻译
      this.activeTranslations.delete(task.id);
      
      // 发送翻译完成事件
      this.emit('segmentTranslated', {
        sessionId: task.sessionId,
        segmentId: task.segmentId,
        originalText: task.text,
        translatedText: translation,
        sourceLanguage: task.sourceLanguage,
        targetLanguage: task.targetLanguage,
        timestamp: task.timestamp
      });
      
      console.log(`[${task.sessionId}] 分段 ${task.segmentId} 翻译完成: "${translation}"`);
      
    } catch (error) {
      console.error(`[${task.sessionId}] 分段 ${task.segmentId} 翻译失败:`, error);
      
      // 移除活跃翻译
      this.activeTranslations.delete(task.id);
      
      // 发送错误事件
      this.emit('segmentError', {
        sessionId: task.sessionId,
        segmentId: task.segmentId,
        error: error.message,
        type: 'translation'
      });
    }
  }

  // 将 Blob 转换为临时文件
  async blobToTempFile(blob, segmentId) {
    const tempDir = './uploads';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFilePath = `${tempDir}/segment_${segmentId}_${Date.now()}.webm`;
    const buffer = Buffer.from(await blob.arrayBuffer());
    
    fs.writeFileSync(tempFilePath, buffer);
    return tempFilePath;
  }

  // 获取队列状态
  getQueueStatus() {
    return {
      transcriptionQueue: this.transcriptionQueue.length,
      translationQueue: this.translationQueue.length,
      activeTranscriptions: this.activeTranscriptions.size,
      activeTranslations: this.activeTranslations.size,
      totalActive: this.activeTranscriptions.size + this.activeTranslations.size
    };
  }

  // 清空队列
  clearQueues() {
    this.transcriptionQueue = [];
    this.translationQueue = [];
    this.activeTranscriptions.clear();
    this.activeTranslations.clear();
    console.log('所有处理队列已清空');
  }

  // 更新 API Key
  updateApiKey(newApiKey) {
    if (!newApiKey || newApiKey.trim() === '') {
      throw new Error('API Key 不能为空');
    }
    
    this.apiKey = newApiKey.trim();
    this.groq = new Groq({ apiKey: this.apiKey });
    console.log('API Key 已更新');
  }

  // 翻译文本
  async translateText(text, targetLanguage = 'zh') {
    try {
      const languageMap = {
        'zh': '中文',
        'en': 'English',
        'ja': '日本語',
        'ko': '한국어',
        'fr': 'Français',
        'de': 'Deutsch',
        'es': 'Español'
      };

      const targetLangName = languageMap[targetLanguage] || '中文';

      const chatCompletion = await this.groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `你是一个专业的翻译助手。请将用户输入的文本翻译成${targetLangName}。只返回翻译结果，不要添加任何解释或额外内容。`
          },
          {
            role: "user",
            content: text
          }
        ],
        model: "openai/gpt-oss-20b",
        temperature: 0.1
      });

      return chatCompletion.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('翻译错误:', error);
      throw error;
    }
  }
}

export default VoiceService;