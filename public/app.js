import AudioRecorder from './audio-recorder.js';

class VoiceTranslatorClient {
    constructor() {
        this.ws = null;
        this.isRecording = false;
        this.isContinuousMode = false;
        this.isConnected = false;
        this.audioRecorder = new AudioRecorder();
        this.processingQueue = [];
        this.isProcessing = false;
        this.pendingSessions = new Map(); // 跟踪处理中的会话
        this.activeSegments = new Map(); // 跟踪活跃的分段
        this.segmentCounter = 0;
        
        this.initElements();
        this.checkBrowserSupport();
        this.initWebSocket();
        this.bindEvents();
        this.setupSmartAudioRecorderCallbacks();
        this.loadHistory();
    }

    async checkBrowserSupport() {
        // 检查基本浏览器支持
        if (!AudioRecorder.isSupported()) {
            this.showStatus('浏览器不支持录音功能，请使用现代浏览器', 'error');
            this.recordBtn.disabled = true;
            this.recordBtn.title = '浏览器不支持录音功能';
            return;
        }

        // 检查安全环境
        if (!AudioRecorder.isSecureContext()) {
            this.showStatus('录音功能需要在安全环境(HTTPS)下使用', 'error');
            this.recordBtn.disabled = true;
            this.initMicBtn.style.display = 'none';
            return;
        }

        // 检查权限状态
        const permissionState = await this.audioRecorder.checkPermission();
        
        if (permissionState === 'granted') {
            // 权限已授予，直接初始化
            try {
                await this.audioRecorder.initialize();
                this.recordBtn.disabled = false;
                this.recordBtn.title = '';
                this.initMicBtn.style.display = 'none';
                this.showStatus('麦克风已就绪，可以开始实时转录', 'success');
            } catch (error) {
                this.showInitButton();
            }
        } else if (permissionState === 'denied') {
            this.showStatus('麦克风权限被拒绝，请查看权限设置帮助', 'error');
            this.recordBtn.disabled = true;
            this.initMicBtn.style.display = 'none';
            this.permissionGuide.style.display = 'inline-block';
        } else {
            // 需要请求权限
            this.showInitButton();
        }
    }

    showInitButton() {
        this.initMicBtn.style.display = 'inline-block';
        this.recordBtn.disabled = true;
        this.recordBtn.title = '请先初始化麦克风权限';
    }

    initElements() {
        this.recordBtn = document.getElementById('recordBtn');
        this.sourceLangSelect = document.getElementById('sourceLang');
        this.targetLangSelect = document.getElementById('targetLang');
        this.originalText = document.getElementById('originalText');
        this.translatedText = document.getElementById('translatedText');
        this.manualInput = document.getElementById('manualInput');
        this.translateBtn = document.getElementById('translateBtn');
        this.historyList = document.getElementById('historyList');
        this.refreshHistoryBtn = document.getElementById('refreshHistory');
        this.status = document.getElementById('status');
        
        // 状态指示器
        this.transcriptionStatus = document.getElementById('transcriptionStatus');
        this.translationStatus = document.getElementById('translationStatus');
        
        // 音频上传相关元素
        this.audioFile = document.getElementById('audioFile');
        this.uploadBtn = document.getElementById('uploadBtn');
        this.fileName = document.getElementById('fileName');
        this.processBtn = document.getElementById('processBtn');
        this.initMicBtn = document.getElementById('initMicBtn');
        this.permissionGuide = document.getElementById('permissionGuide');
        
        // API Key 设置相关元素
        this.apiKeyToggle = document.getElementById('apiKeyToggle');
        this.apiKeyPanel = document.getElementById('apiKeyPanel');
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.apiKeyStatus = document.getElementById('apiKeyStatus');
        this.toggleApiKeyVisibility = document.getElementById('toggleApiKeyVisibility');
        this.saveApiKey = document.getElementById('saveApiKey');
        this.testApiKey = document.getElementById('testApiKey');

        // 智能分段设置相关元素
        this.settingsToggle = document.getElementById('settingsToggle');
        this.settingsPanel = document.getElementById('settingsPanel');
        this.silenceThreshold = document.getElementById('silenceThreshold');
        this.silenceThresholdValue = document.getElementById('silenceThresholdValue');
        this.pauseDetectionTime = document.getElementById('pauseDetectionTime');
        this.pauseDetectionTimeValue = document.getElementById('pauseDetectionTimeValue');
        this.minSegmentDuration = document.getElementById('minSegmentDuration');
        this.minSegmentDurationValue = document.getElementById('minSegmentDurationValue');
        this.maxSegmentDuration = document.getElementById('maxSegmentDuration');
        this.maxSegmentDurationValue = document.getElementById('maxSegmentDurationValue');
        this.consecutiveSilenceFrames = document.getElementById('consecutiveSilenceFrames');
        this.consecutiveSilenceFramesValue = document.getElementById('consecutiveSilenceFramesValue');
        this.resetSettings = document.getElementById('resetSettings');
        this.saveSettings = document.getElementById('saveSettings');
        
        // 初始化设置
        this.initSegmentSettings();
        this.initApiKeySettings();
    }

    initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            this.isConnected = true;
            this.showStatus('已连接到服务器', 'success');
            console.log('WebSocket连接已建立');
        };
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
        
        this.ws.onclose = () => {
            this.isConnected = false;
            this.showStatus('与服务器连接断开', 'error');
            console.log('WebSocket连接已关闭');
            
            // 尝试重连
            setTimeout(() => {
                this.initWebSocket();
            }, 3000);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
            this.showStatus('连接错误', 'error');
        };
    }

    bindEvents() {
        this.recordBtn.addEventListener('click', () => {
            if (this.isContinuousMode) {
                this.stopContinuousRecording();
            } else {
                this.startContinuousRecording();
            }
        });

        this.translateBtn.addEventListener('click', () => {
            this.translateManualText();
        });

        this.refreshHistoryBtn.addEventListener('click', () => {
            this.loadHistory();
        });

        this.manualInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.translateManualText();
            }
        });

        // 音频上传事件
        this.uploadBtn.addEventListener('click', () => {
            this.audioFile.click();
        });

        this.audioFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.fileName.textContent = `已选择: ${file.name}`;
                this.processBtn.disabled = false;
            } else {
                this.fileName.textContent = '';
                this.processBtn.disabled = true;
            }
        });

        this.processBtn.addEventListener('click', () => {
            this.processAudioFile();
        });

        this.initMicBtn.addEventListener('click', () => {
            this.initializeMicrophone();
        });

        // API Key 设置事件
        this.apiKeyToggle.addEventListener('click', () => {
            this.toggleApiKeyPanel();
        });

        this.toggleApiKeyVisibility.addEventListener('click', () => {
            this.togglePasswordVisibility();
        });

        this.saveApiKey.addEventListener('click', () => {
            this.saveApiKeySettings();
        });

        this.testApiKey.addEventListener('click', () => {
            this.testApiKeyConnection();
        });

        // 智能分段设置事件
        this.settingsToggle.addEventListener('click', () => {
            this.toggleSettingsPanel();
        });

        // 参数滑块事件
        this.silenceThreshold.addEventListener('input', (e) => {
            this.silenceThresholdValue.textContent = e.target.value;
        });

        this.pauseDetectionTime.addEventListener('input', (e) => {
            this.pauseDetectionTimeValue.textContent = e.target.value;
        });

        this.minSegmentDuration.addEventListener('input', (e) => {
            this.minSegmentDurationValue.textContent = e.target.value;
        });

        this.maxSegmentDuration.addEventListener('input', (e) => {
            this.maxSegmentDurationValue.textContent = e.target.value;
        });

        this.consecutiveSilenceFrames.addEventListener('input', (e) => {
            this.consecutiveSilenceFramesValue.textContent = e.target.value;
        });

        // 设置按钮事件
        this.resetSettings.addEventListener('click', () => {
            this.resetSegmentSettings();
        });

        this.saveSettings.addEventListener('click', () => {
            this.saveSegmentSettings();
        });
    }

    async initializeMicrophone() {
        try {
            this.showStatus('正在请求麦克风权限...', 'success');
            await this.audioRecorder.initialize();
            
            this.recordBtn.disabled = false;
            this.recordBtn.title = '';
            this.initMicBtn.style.display = 'none';
            this.permissionGuide.style.display = 'none';
            
            this.showStatus('麦克风已初始化，可以开始实时转录', 'success');
        } catch (error) {
            console.error('麦克风初始化失败:', error);
            this.showStatus(`${error.message}`, 'error');
            
            // 如果是权限问题，显示帮助链接
            if (error.message.includes('权限被拒绝') || error.message.includes('NotAllowedError')) {
                this.permissionGuide.style.display = 'inline-block';
            }
        }
    }

    async startContinuousRecording() {
        if (!this.isConnected) {
            this.showStatus('未连接到服务器', 'error');
            return;
        }

        if (!this.audioRecorder.stream) {
            this.showStatus('请先初始化麦克风权限', 'error');
            return;
        }

        try {
            // 配置智能分段参数（使用用户设置）
            this.audioRecorder.setSegmentConfig(this.getSegmentConfig());

            await this.audioRecorder.startSmartSegmentRecording();
            this.isContinuousMode = true;
            this.segmentCounter = 0;
            this.recordBtn.classList.add('continuous');
            this.recordBtn.querySelector('.btn-text').textContent = '停止智能转录';
            this.showStatus('智能分段转录已启动，开始说话...', 'success');

        } catch (error) {
            console.error('智能分段录音启动失败:', error);
            this.showStatus(`启动失败: ${error.message}`, 'error');
        }
    }

    stopContinuousRecording() {
        if (!this.isContinuousMode) {
            return;
        }

        this.audioRecorder.stopSmartSegmentRecording();
        this.isContinuousMode = false;
        this.recordBtn.classList.remove('continuous', 'voice-detected', 'segment-active');
        this.recordBtn.querySelector('.btn-text').textContent = '开始智能转录';
        this.showStatus('智能分段转录已停止', 'success');
        
        // 清理活跃分段记录
        this.activeSegments.clear();
    }

    setupSmartAudioRecorderCallbacks() {
        this.audioRecorder.setSmartCallbacks({
            // 检测到语音
            onVoiceDetected: () => {
                this.recordBtn.classList.add('voice-detected');
                this.showStatus('检测到语音...', 'success');
            },
            
            // 检测到静音
            onSilenceDetected: () => {
                this.recordBtn.classList.remove('voice-detected');
                this.showStatus('等待语音输入...', 'success');
            },
            
            // 分段开始
            onSegmentStart: (segmentId) => {
                this.segmentCounter++;
                this.recordBtn.classList.add('segment-active');
                this.showStatus(`开始录制分段 ${this.segmentCounter}...`, 'success');
                
                // 记录分段信息
                this.activeSegments.set(segmentId, {
                    counter: this.segmentCounter,
                    startTime: Date.now(),
                    status: 'recording'
                });
            },
            
            // 分段结束
            onSegmentEnd: (segmentId, duration) => {
                this.recordBtn.classList.remove('segment-active');
                const segment = this.activeSegments.get(segmentId);
                if (segment) {
                    this.showStatus(`分段 ${segment.counter} 录制完成 (${Math.round(duration/1000)}s)`, 'success');
                }
            },
            
            // 分段音频准备就绪
            onSegmentReady: (audioBlob, segmentId, duration) => {
                const segment = this.activeSegments.get(segmentId);
                if (segment) {
                    segment.status = 'processing';
                    this.showStatus(`处理分段 ${segment.counter}...`, 'success');
                }
                
                // 异步处理分段音频
                this.processAudioSegment(audioBlob, segmentId, duration);
            },
            
            // 保持向后兼容
            onAudioReady: (audioBlob) => {
                // 如果没有使用智能分段，回退到原有处理方式
                if (!this.isContinuousMode) {
                    this.queueAudioProcessing(audioBlob);
                }
            }
        });
    }

    // 保持向后兼容的方法
    setupAudioRecorderCallbacks() {
        return this.setupSmartAudioRecorderCallbacks();
    }

    // 处理音频分段（智能分段模式）
    async processAudioSegment(audioBlob, segmentId, duration) {
        try {
            console.log(`开始处理音频分段: ${segmentId}, 大小: ${audioBlob.size} bytes, 时长: ${duration}ms`);
            
            const segment = this.activeSegments.get(segmentId);
            if (!segment) {
                console.warn(`未找到分段信息: ${segmentId}`);
                return;
            }

            // 验证音频数据
            if (!audioBlob || audioBlob.size === 0) {
                console.error(`分段 ${segmentId} 音频数据为空`);
                this.showStatus(`分段 ${segment.counter} 音频数据为空`, 'error');
                return;
            }

            // 创建会话ID
            const sessionId = `segment-${Date.now()}-${segmentId}`;
            
            console.log(`准备上传分段 ${segmentId} 到服务器, 会话ID: ${sessionId}`);
            
            // 发送到后端处理
            const formData = new FormData();
            formData.append('audio', audioBlob, `${segmentId}.webm`);
            formData.append('sourceLanguage', this.sourceLangSelect.value || 'auto');
            formData.append('targetLanguage', this.targetLangSelect.value || 'zh');
            formData.append('sessionId', sessionId);
            formData.append('segmentId', segmentId);
            formData.append('isSegment', 'true');

            console.log(`上传参数: 源语言=${this.sourceLangSelect.value}, 目标语言=${this.targetLangSelect.value}`);

            const response = await fetch('/api/upload-audio', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json();
            console.log(`服务器响应:`, result);
            
            if (result.status === 'processing') {
                segment.sessionId = sessionId;
                this.showStatus(`分段 ${segment.counter} 已提交处理`, 'success');
                console.log(`分段 ${segmentId} 已成功提交到服务器处理`);
            } else {
                console.warn(`分段 ${segmentId} 服务器返回异常状态:`, result);
            }
            
        } catch (error) {
            console.error(`分段 ${segmentId} 处理失败:`, error);
            const segment = this.activeSegments.get(segmentId);
            if (segment) {
                this.showStatus(`分段 ${segment.counter} 处理失败: ${error.message}`, 'error');
            }
        }
    }

    queueAudioProcessing(audioBlob) {
        this.processingQueue.push(audioBlob);
        this.processNextAudio();
    }

    async processNextAudio() {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return;
        }

        this.isProcessing = true;
        const audioBlob = this.processingQueue.shift();

        try {
            await this.processRecordedAudio(audioBlob);
        } catch (error) {
            console.error('音频处理失败:', error);
            this.showStatus(`处理失败: ${error.message}`, 'error');
        } finally {
            this.isProcessing = false;
            // 处理队列中的下一个音频
            if (this.processingQueue.length > 0) {
                setTimeout(() => this.processNextAudio(), 100);
            } else if (this.isContinuousMode) {
                this.showStatus('等待语音输入...', 'success');
            }
        }
    }

    async processRecordedAudio(audioBlob) {
        const formData = new FormData();
        
        // 创建文件名和会话ID
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `recording-${timestamp}.webm`;
        const sessionId = `session-${timestamp}-${Math.random().toString(36).substring(2, 11)}`;
        
        formData.append('audio', audioBlob, fileName);
        formData.append('sourceLanguage', this.sourceLangSelect.value);
        formData.append('targetLanguage', this.targetLangSelect.value);
        formData.append('sessionId', sessionId);

        try {
            // 显示处理状态
            this.showProcessingStatus('正在转录...', '等待转录完成...');
            this.updateStatusIndicators('processing', 'processing');
            
            const response = await fetch('/api/upload-audio', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.status === 'processing') {
                this.showStatus('音频上传成功，正在异步处理...', 'success');
                // 结果将通过WebSocket异步返回
            } else {
                // 兼容旧版本同步返回
                this.appendToResults(result.original || '转录失败', result.translated || '翻译失败');
                this.showStatus('录音处理完成', 'success');
                this.updateStatusIndicators('completed', 'completed');
                this.loadHistory();
            }
            
        } catch (error) {
            console.error('音频处理失败:', error);
            this.showStatus(`处理失败: ${error.message}`, 'error');
            this.appendToResults('处理失败', '处理失败');
            this.updateStatusIndicators('error', 'error');
        }
    }

    translateManualText() {
        const text = this.manualInput.value.trim();
        if (!text) {
            this.showStatus('请输入要翻译的文本', 'error');
            return;
        }

        if (!this.isConnected) {
            this.showStatus('未连接到服务器', 'error');
            return;
        }

        const sessionId = `manual-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

        this.ws.send(JSON.stringify({
            type: 'translate',
            text: text,
            targetLanguage: this.targetLangSelect.value,
            sessionId: sessionId
        }));

        // 立即显示正在翻译的状态
        this.appendTranscription(text, sessionId);
        this.showStatus('正在翻译...', 'success');
    }

    handleMessage(data) {
        switch (data.type) {
            case 'translationResult':
                this.appendToResults(data.original, data.translated);
                this.manualInput.value = '';
                this.showStatus('翻译完成', 'success');
                this.updateStatusIndicators('completed', 'completed');
                break;

            case 'translationProcessing':
                // WebSocket翻译处理中状态
                this.showStatus('正在翻译...', 'success');
                break;

            case 'transcriptionComplete':
                // 转录完成，追加原文并显示翻译状态
                this.appendTranscription(data.original, data.sessionId);
                this.showStatus('转录完成，正在翻译...', 'success');
                
                // 更新状态指示器
                this.updateStatusIndicators('completed', 'processing');
                
                // 记录会话信息
                this.pendingSessions.set(data.sessionId, {
                    original: data.original,
                    sourceLanguage: data.sourceLanguage,
                    targetLanguage: data.targetLanguage
                });
                break;

            case 'translationComplete':
                // 翻译完成，更新对应的翻译结果
                this.updateTranslation(data.sessionId, data.translated);
                this.showStatus('转录和翻译完成', 'success');
                
                // 更新状态指示器
                this.updateStatusIndicators('completed', 'completed');
                
                // 清理会话记录
                if (data.sessionId) {
                    this.pendingSessions.delete(data.sessionId);
                }
                
                // 刷新历史记录
                this.loadHistory();
                break;

            // 智能分段事件处理
            case 'segmentTranscribed':
                this.handleSegmentTranscribed(data);
                break;

            case 'segmentTranslated':
                this.handleSegmentTranslated(data);
                break;

            case 'segmentError':
                this.handleSegmentError(data);
                break;

            case 'processingError':
                this.showStatus(`处理错误: ${data.error}`, 'error');
                this.updateStatusIndicators('error', 'error');
                
                // 清理会话记录
                if (data.sessionId) {
                    this.pendingSessions.delete(data.sessionId);
                }
                break;

            case 'error':
                this.showStatus(`错误: ${data.message}`, 'error');
                this.updateStatusIndicators('error', 'error');
                if (this.isRecording) {
                    this.isRecording = false;
                    this.recordBtn.classList.remove('recording');
                    this.recordBtn.querySelector('.btn-text').textContent = '开始录音';
                }
                break;
        }
    }

    // 处理分段转录完成
    handleSegmentTranscribed(data) {
        const segment = this.activeSegments.get(data.segmentId);
        if (segment) {
            this.showStatus(`分段 ${segment.counter} 转录完成`, 'success');
            segment.status = 'transcribed';
        }
        
        // 显示转录结果
        this.appendTranscription(data.originalText, data.sessionId, data.segmentId);
        
        // 记录会话信息
        this.pendingSessions.set(data.sessionId, {
            original: data.originalText,
            sourceLanguage: data.detectedLanguage,
            segmentId: data.segmentId
        });
    }

    // 处理分段翻译完成
    handleSegmentTranslated(data) {
        const segment = this.activeSegments.get(data.segmentId);
        if (segment) {
            this.showStatus(`分段 ${segment.counter} 翻译完成`, 'success');
            segment.status = 'completed';
        }
        
        // 更新翻译结果
        this.updateTranslation(data.sessionId, data.translatedText);
        
        // 清理会话记录
        this.pendingSessions.delete(data.sessionId);
        
        // 清理分段记录
        this.activeSegments.delete(data.segmentId);
        
        // 刷新历史记录
        this.loadHistory();
    }

    // 处理分段错误
    handleSegmentError(data) {
        const segment = this.activeSegments.get(data.segmentId);
        if (segment) {
            this.showStatus(`分段 ${segment.counter} 处理失败: ${data.error}`, 'error');
            segment.status = 'error';
        }
        
        // 清理记录
        this.pendingSessions.delete(data.sessionId);
        this.activeSegments.delete(data.segmentId);
    }

    updateStatusIndicators(transcriptionStatus, translationStatus) {
        // 更新转录状态
        this.transcriptionStatus.className = `status-indicator ${transcriptionStatus}`;
        switch (transcriptionStatus) {
            case 'processing':
                this.transcriptionStatus.textContent = '转录中...';
                break;
            case 'completed':
                this.transcriptionStatus.textContent = '已完成';
                break;
            case 'error':
                this.transcriptionStatus.textContent = '失败';
                break;
            default:
                this.transcriptionStatus.style.display = 'none';
                return;
        }

        // 更新翻译状态
        this.translationStatus.className = `status-indicator ${translationStatus}`;
        switch (translationStatus) {
            case 'processing':
                this.translationStatus.textContent = '翻译中...';
                break;
            case 'completed':
                this.translationStatus.textContent = '已完成';
                break;
            case 'error':
                this.translationStatus.textContent = '失败';
                break;
            default:
                this.translationStatus.style.display = 'none';
                return;
        }
    }

    async loadHistory() {
        try {
            const response = await fetch('/api/history');
            const conversations = await response.json();
            
            this.historyList.innerHTML = '';
            
            conversations.forEach(conv => {
                const item = document.createElement('div');
                item.className = 'history-item';
                
                const timestamp = new Date(conv.timestamp).toLocaleString('zh-CN');
                
                item.innerHTML = `
                    <div class="timestamp">${timestamp}</div>
                    <div class="original"><strong>原文:</strong> ${conv.original_text}</div>
                    <div class="translated"><strong>翻译:</strong> ${conv.translated_text}</div>
                `;
                
                this.historyList.appendChild(item);
            });
        } catch (error) {
            console.error('加载历史记录失败:', error);
            this.showStatus('加载历史记录失败', 'error');
        }
    }

    async processAudioFile() {
        const file = this.audioFile.files[0];
        if (!file) {
            this.showStatus('请先选择音频文件', 'error');
            return;
        }

        const formData = new FormData();
        const sessionId = `file-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        
        formData.append('audio', file);
        formData.append('sourceLanguage', this.sourceLangSelect.value);
        formData.append('targetLanguage', this.targetLangSelect.value);
        formData.append('sessionId', sessionId);

        this.showStatus('正在处理音频文件...', 'success');
        this.processBtn.disabled = true;

        // 显示处理状态
        this.originalText.textContent = '正在转录音频文件...';
        this.translatedText.textContent = '等待转录完成...';
        this.updateStatusIndicators('processing', 'processing');

        try {
            const response = await fetch('/api/upload-audio', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.status === 'processing') {
                this.showStatus('文件上传成功，正在异步处理...', 'success');
                // 结果将通过WebSocket异步返回
            } else {
                // 兼容旧版本同步返回
                this.originalText.textContent = result.original || '转录失败';
                this.translatedText.textContent = result.translated || '翻译失败';
                this.showStatus('音频处理完成', 'success');
                this.updateStatusIndicators('completed', 'completed');
                this.loadHistory();
            }
            
            // 清空文件选择
            this.audioFile.value = '';
            this.fileName.textContent = '';
            this.processBtn.disabled = true;
            
        } catch (error) {
            console.error('音频处理失败:', error);
            this.showStatus(`处理失败: ${error.message}`, 'error');
            this.appendToResults('处理失败', '处理失败');
            this.updateStatusIndicators('error', 'error');
        } finally {
            this.processBtn.disabled = false;
        }
    }

    showStatus(message, type = 'success') {
        this.status.textContent = message;
        this.status.className = `status show ${type}`;
        
        setTimeout(() => {
            this.status.classList.remove('show');
        }, 3000);
    }

    // 显示处理状态（不追加，只是临时显示）
    showProcessingStatus(transcriptionMsg, translationMsg) {
        // 创建临时状态显示
        const tempTranscription = document.createElement('div');
        tempTranscription.className = 'temp-status processing';
        tempTranscription.textContent = transcriptionMsg;
        
        const tempTranslation = document.createElement('div');
        tempTranslation.className = 'temp-status processing';
        tempTranslation.textContent = translationMsg;
        
        // 如果原文区域为空或只有初始提示，显示处理状态
        if (this.originalText.children.length === 0 || 
            this.originalText.textContent.includes('点击"开始实时转录"')) {
            this.originalText.innerHTML = '';
            this.originalText.appendChild(tempTranscription);
        }
        
        if (this.translatedText.children.length === 0 || 
            this.translatedText.textContent.includes('翻译结果将实时显示')) {
            this.translatedText.innerHTML = '';
            this.translatedText.appendChild(tempTranslation);
        }
    }

    // 追加转录结果
    appendTranscription(text, sessionId, segmentId = null) {
        // 清除临时状态
        this.clearTempStatus();
        
        // 创建新的转录条目
        const transcriptionItem = document.createElement('div');
        transcriptionItem.className = 'result-item';
        transcriptionItem.dataset.sessionId = sessionId;
        if (segmentId) {
            transcriptionItem.dataset.segmentId = segmentId;
        }
        
        const timestamp = new Date().toLocaleTimeString();
        const segmentLabel = segmentId && this.activeSegments.has(segmentId) ? 
            ` [分段 ${this.activeSegments.get(segmentId).counter}]` : '';
        
        transcriptionItem.innerHTML = `
            <div class="timestamp">${timestamp}${segmentLabel}</div>
            <div class="content">${text}</div>
        `;
        
        this.originalText.appendChild(transcriptionItem);
        this.originalText.scrollTop = this.originalText.scrollHeight;
        
        // 在翻译区域添加对应的等待项
        const translationItem = document.createElement('div');
        translationItem.className = 'result-item pending';
        translationItem.dataset.sessionId = sessionId;
        if (segmentId) {
            translationItem.dataset.segmentId = segmentId;
        }
        translationItem.innerHTML = `
            <div class="timestamp">${timestamp}${segmentLabel}</div>
            <div class="content">正在翻译...</div>
        `;
        
        this.translatedText.appendChild(translationItem);
        this.translatedText.scrollTop = this.translatedText.scrollHeight;
    }

    // 更新翻译结果
    updateTranslation(sessionId, translatedText) {
        const translationItem = this.translatedText.querySelector(`[data-session-id="${sessionId}"]`);
        if (translationItem) {
            translationItem.classList.remove('pending');
            translationItem.querySelector('.content').textContent = translatedText;
        }
    }

    // 追加完整的转录和翻译结果（用于手动翻译等）
    appendToResults(originalText, translatedText) {
        // 清除临时状态
        this.clearTempStatus();
        
        const timestamp = new Date().toLocaleTimeString();
        const sessionId = `manual-${Date.now()}`;
        
        // 添加原文
        const transcriptionItem = document.createElement('div');
        transcriptionItem.className = 'result-item';
        transcriptionItem.dataset.sessionId = sessionId;
        transcriptionItem.innerHTML = `
            <div class="timestamp">${timestamp}</div>
            <div class="content">${originalText}</div>
        `;
        this.originalText.appendChild(transcriptionItem);
        
        // 添加翻译
        const translationItem = document.createElement('div');
        translationItem.className = 'result-item';
        translationItem.dataset.sessionId = sessionId;
        translationItem.innerHTML = `
            <div class="timestamp">${timestamp}</div>
            <div class="content">${translatedText}</div>
        `;
        this.translatedText.appendChild(translationItem);
        
        // 滚动到底部
        this.originalText.scrollTop = this.originalText.scrollHeight;
        this.translatedText.scrollTop = this.translatedText.scrollHeight;
    }

    // 清除临时状态显示
    clearTempStatus() {
        const tempElements = document.querySelectorAll('.temp-status');
        tempElements.forEach(el => el.remove());
    }

    // 初始化智能分段设置
    initSegmentSettings() {
        // 从本地存储加载设置
        this.loadSegmentSettings();
        
        // 更新显示值
        this.updateSettingValues();
    }

    // 切换设置面板显示
    toggleSettingsPanel() {
        const isVisible = this.settingsPanel.style.display !== 'none';
        
        if (isVisible) {
            this.settingsPanel.style.display = 'none';
            this.settingsToggle.classList.remove('active');
            this.settingsToggle.textContent = '⚙️ 智能分段设置';
        } else {
            this.settingsPanel.style.display = 'block';
            this.settingsToggle.classList.add('active');
            this.settingsToggle.textContent = '⚙️ 收起设置';
        }
    }

    // 获取当前分段配置
    getSegmentConfig() {
        return {
            silenceThreshold: parseInt(this.silenceThreshold.value),
            pauseDetectionTime: parseInt(this.pauseDetectionTime.value),
            minSegmentDuration: parseInt(this.minSegmentDuration.value),
            maxSegmentDuration: parseInt(this.maxSegmentDuration.value) * 1000, // 转换为毫秒
            consecutiveSilenceFrames: parseInt(this.consecutiveSilenceFrames.value)
        };
    }

    // 更新设置显示值
    updateSettingValues() {
        this.silenceThresholdValue.textContent = this.silenceThreshold.value;
        this.pauseDetectionTimeValue.textContent = this.pauseDetectionTime.value;
        this.minSegmentDurationValue.textContent = this.minSegmentDuration.value;
        this.maxSegmentDurationValue.textContent = this.maxSegmentDuration.value;
        this.consecutiveSilenceFramesValue.textContent = this.consecutiveSilenceFrames.value;
    }

    // 重置为默认设置
    resetSegmentSettings() {
        const defaultSettings = {
            silenceThreshold: 30,
            pauseDetectionTime: 800,
            minSegmentDuration: 1000,
            maxSegmentDuration: 15,  // 更新默认值为15秒
            consecutiveSilenceFrames: 8
        };

        this.applySettings(defaultSettings);
        this.showStatus('已重置为默认设置', 'success');
    }

    // 保存设置
    saveSegmentSettings() {
        const settings = {
            silenceThreshold: parseInt(this.silenceThreshold.value),
            pauseDetectionTime: parseInt(this.pauseDetectionTime.value),
            minSegmentDuration: parseInt(this.minSegmentDuration.value),
            maxSegmentDuration: parseInt(this.maxSegmentDuration.value),
            consecutiveSilenceFrames: parseInt(this.consecutiveSilenceFrames.value)
        };

        // 保存到本地存储
        localStorage.setItem('segmentSettings', JSON.stringify(settings));
        
        // 如果正在录音，立即应用新设置
        if (this.isContinuousMode) {
            this.audioRecorder.setSegmentConfig(this.getSegmentConfig());
        }

        // 显示保存成功动画
        this.saveSettings.classList.add('saved');
        this.saveSettings.textContent = '已保存';
        
        setTimeout(() => {
            this.saveSettings.classList.remove('saved');
            this.saveSettings.textContent = '保存设置';
        }, 1000);

        this.showStatus('设置已保存', 'success');
    }

    // 从本地存储加载设置
    loadSegmentSettings() {
        try {
            const savedSettings = localStorage.getItem('segmentSettings');
            if (savedSettings) {
                const settings = JSON.parse(savedSettings);
                this.applySettings(settings);
            } else {
                // 使用默认设置
                this.resetSegmentSettings();
            }
        } catch (error) {
            console.error('加载设置失败:', error);
            this.resetSegmentSettings();
        }
    }

    // 应用设置到UI控件
    applySettings(settings) {
        this.silenceThreshold.value = settings.silenceThreshold || 30;
        this.pauseDetectionTime.value = settings.pauseDetectionTime || 800;
        this.minSegmentDuration.value = settings.minSegmentDuration || 1000;
        this.maxSegmentDuration.value = settings.maxSegmentDuration || 15;  // 更新默认值为15秒
        this.consecutiveSilenceFrames.value = settings.consecutiveSilenceFrames || 8;
        
        this.updateSettingValues();
    }

    // 获取设置摘要（用于显示当前配置）
    getSettingsSummary() {
        const config = this.getSegmentConfig();
        return `静音阈值: ${config.silenceThreshold}, 停顿检测: ${config.pauseDetectionTime}ms, 分段时长: ${config.minSegmentDuration}-${config.maxSegmentDuration/1000}s, 静音帧: ${config.consecutiveSilenceFrames}`;
    }

    // 初始化 API Key 设置
    async initApiKeySettings() {
        await this.checkApiKeyStatus();
    }

    // 切换 API Key 面板显示
    toggleApiKeyPanel() {
        const isVisible = this.apiKeyPanel.style.display !== 'none';
        
        if (isVisible) {
            this.apiKeyPanel.style.display = 'none';
            this.apiKeyToggle.classList.remove('active');
            this.apiKeyToggle.textContent = '🔑 API Key 设置';
        } else {
            this.apiKeyPanel.style.display = 'block';
            this.apiKeyToggle.classList.add('active');
            this.apiKeyToggle.textContent = '🔑 收起设置';
        }
    }

    // 切换 API Key 可见性
    togglePasswordVisibility() {
        const input = this.apiKeyInput;
        const button = this.toggleApiKeyVisibility;
        
        if (input.type === 'password') {
            input.type = 'text';
            button.textContent = '🙈';
        } else {
            input.type = 'password';
            button.textContent = '👁️';
        }
    }

    // 检查 API Key 状态
    async checkApiKeyStatus() {
        try {
            const response = await fetch('/api/api-key-status');
            const result = await response.json();
            
            if (result.hasKey) {
                this.apiKeyStatus.textContent = `✅ API Key 已配置 (${result.keyPreview}) - 来源: ${result.keySource === 'database' ? '数据库' : '环境变量'}`;
                this.apiKeyStatus.className = 'status-text success';
            } else {
                this.apiKeyStatus.textContent = '❌ 未配置 API Key，请设置后使用';
                this.apiKeyStatus.className = 'status-text error';
            }
        } catch (error) {
            console.error('检查 API Key 状态失败:', error);
            this.apiKeyStatus.textContent = '⚠️ 无法检查 API Key 状态';
            this.apiKeyStatus.className = 'status-text warning';
        }
    }

    // 保存 API Key 设置
    async saveApiKeySettings() {
        const apiKey = this.apiKeyInput.value.trim();
        
        if (!apiKey) {
            this.showStatus('请输入 API Key', 'error');
            return;
        }

        // 简单验证 API Key 格式
        if (!apiKey.startsWith('gsk_')) {
            this.showStatus('API Key 格式不正确，应该以 gsk_ 开头', 'error');
            return;
        }

        try {
            this.saveApiKey.disabled = true;
            this.saveApiKey.textContent = '保存中...';

            const response = await fetch('/api/set-api-key', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ apiKey })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                this.showStatus('API Key 保存成功', 'success');
                this.apiKeyInput.value = '';
                await this.checkApiKeyStatus();
                
                // 显示保存成功动画
                this.saveApiKey.classList.add('saved');
                this.saveApiKey.textContent = '已保存';
                
                setTimeout(() => {
                    this.saveApiKey.classList.remove('saved');
                    this.saveApiKey.textContent = '保存 API Key';
                }, 1000);
            } else {
                throw new Error(result.error || '保存失败');
            }
        } catch (error) {
            console.error('保存 API Key 失败:', error);
            this.showStatus(`保存失败: ${error.message}`, 'error');
        } finally {
            this.saveApiKey.disabled = false;
            if (this.saveApiKey.textContent === '保存中...') {
                this.saveApiKey.textContent = '保存 API Key';
            }
        }
    }

    // 测试 API Key 连接
    async testApiKeyConnection() {
        try {
            this.testApiKey.disabled = true;
            this.testApiKey.textContent = '测试中...';

            // 使用翻译 API 测试连接
            const response = await fetch('/api/translate-text', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: 'Hello',
                    targetLanguage: 'zh',
                    sessionId: `test-${Date.now()}`
                })
            });

            if (response.ok) {
                this.showStatus('API Key 连接测试成功', 'success');
                this.testApiKey.classList.add('success');
                this.testApiKey.textContent = '测试成功';
                
                setTimeout(() => {
                    this.testApiKey.classList.remove('success');
                    this.testApiKey.textContent = '测试连接';
                }, 2000);
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            console.error('API Key 测试失败:', error);
            this.showStatus(`连接测试失败: ${error.message}`, 'error');
            this.testApiKey.classList.add('error');
            this.testApiKey.textContent = '测试失败';
            
            setTimeout(() => {
                this.testApiKey.classList.remove('error');
                this.testApiKey.textContent = '测试连接';
            }, 2000);
        } finally {
            this.testApiKey.disabled = false;
            if (this.testApiKey.textContent === '测试中...') {
                this.testApiKey.textContent = '测试连接';
            }
        }
    }
}

// 页面加载完成后初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new VoiceTranslatorClient();
});