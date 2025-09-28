class AudioRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.stream = null;
        this.isRecording = false;
        this.isContinuousMode = false;
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.dataArray = null;
        
        // 智能分段配置
        this.segmentConfig = {
            silenceThreshold: 30,        // 静音阈值
            pauseDetectionTime: 800,     // 停顿检测时间（毫秒）
            minSegmentDuration: 1000,    // 最小分段时长（毫秒）
            maxSegmentDuration: 30000,   // 最大分段时长（毫秒）
            energyThreshold: 0.01,       // 能量阈值
            consecutiveSilenceFrames: 8  // 连续静音帧数
        };
        
        // 分段状态
        this.currentSegment = {
            chunks: [],
            startTime: null,
            lastVoiceTime: null,
            segmentId: null
        };
        
        this.segmentCounter = 0;
        this.silenceFrameCount = 0;
        this.isVoiceActive = false;
        this.vadCheckInterval = null;
        this.segmentTimer = null;
        
        // 回调函数
        this.onVoiceDetected = null;
        this.onSilenceDetected = null;
        this.onSegmentReady = null;
        this.onSegmentStart = null;
        this.onSegmentEnd = null;
    }

    async initialize() {
        try {
            // 检查浏览器支持
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('浏览器不支持麦克风访问功能');
            }

            // 请求麦克风权限
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000
                }
            });
            
            // 初始化音频上下文用于语音活动检测
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.microphone = this.audioContext.createMediaStreamSource(this.stream);
            
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            this.microphone.connect(this.analyser);
            
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            
            console.log('麦克风访问权限已获取，语音活动检测已初始化');
            return true;
        } catch (error) {
            console.error('无法访问麦克风:', error);
            
            let errorMessage = '无法访问麦克风';
            
            if (error.name === 'NotAllowedError') {
                errorMessage = '麦克风权限被拒绝。请在浏览器设置中允许麦克风访问，然后刷新页面重试。';
            } else if (error.name === 'NotFoundError') {
                errorMessage = '未找到麦克风设备。请检查麦克风是否正确连接。';
            } else if (error.name === 'NotReadableError') {
                errorMessage = '麦克风被其他应用占用。请关闭其他使用麦克风的应用后重试。';
            } else if (error.name === 'OverconstrainedError') {
                errorMessage = '麦克风不支持所需的音频设置。';
            } else if (error.name === 'SecurityError') {
                errorMessage = '安全限制：请确保在 HTTPS 环境下使用，或在 localhost 进行测试。';
            }
            
            throw new Error(errorMessage);
        }
    }

    async startRecording() {
        if (this.isRecording) {
            console.log('已经在录音中...');
            return;
        }

        if (!this.stream) {
            await this.initialize();
        }

        this.audioChunks = [];
        
        // 创建 MediaRecorder
        this.mediaRecorder = new MediaRecorder(this.stream, {
            mimeType: this.getSupportedMimeType()
        });

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.audioChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            console.log('录音停止');
        };

        this.mediaRecorder.onerror = (event) => {
            console.error('录音错误:', event.error);
        };

        this.mediaRecorder.start(1000); // 每秒收集一次数据
        this.isRecording = true;
        this.recordingStartTime = Date.now();
        
        console.log('开始录音...');
    }

    // 开始智能分段录音模式
    async startSmartSegmentRecording() {
        if (this.isContinuousMode) {
            console.log('已经在智能分段录音模式中...');
            return;
        }

        if (!this.stream) {
            await this.initialize();
        }

        this.isContinuousMode = true;
        this.segmentCounter = 0;
        this.resetCurrentSegment();
        
        console.log('开始智能分段录音模式...');
        
        // 开始语音活动检测和分段处理
        this.startSmartVoiceActivityDetection();
    }

    // 开始连续模式录音（保持向后兼容）
    async startContinuousRecording() {
        return this.startSmartSegmentRecording();
    }

    // 停止智能分段录音模式
    stopSmartSegmentRecording() {
        this.isContinuousMode = false;
        
        if (this.vadCheckInterval) {
            clearInterval(this.vadCheckInterval);
            this.vadCheckInterval = null;
        }
        
        if (this.segmentTimer) {
            clearTimeout(this.segmentTimer);
            this.segmentTimer = null;
        }
        
        // 如果当前有活跃分段，完成它
        if (this.isRecording && this.currentSegment.chunks.length > 0) {
            this.finishCurrentSegment();
        }
        
        if (this.isRecording) {
            this.stopRecording();
        }
        
        console.log('停止智能分段录音模式');
    }

    // 停止连续模式录音（保持向后兼容）
    stopContinuousRecording() {
        return this.stopSmartSegmentRecording();
    }

    // 智能语音活动检测和分段
    startSmartVoiceActivityDetection() {
        this.vadCheckInterval = setInterval(() => {
            if (!this.isContinuousMode) return;
            
            this.analyser.getByteFrequencyData(this.dataArray);
            
            // 计算音频能量
            let sum = 0;
            for (let i = 0; i < this.dataArray.length; i++) {
                sum += this.dataArray[i];
            }
            const average = sum / this.dataArray.length;
            const normalizedEnergy = average / 255.0;
            
            // 检测语音活动
            const isVoiceDetected = average > this.segmentConfig.silenceThreshold;
            
            if (isVoiceDetected) {
                this.handleSmartVoiceDetected();
            } else {
                this.handleSmartSilenceDetected();
            }
            
            // 检查分段时长限制
            this.checkSegmentDurationLimits();
            
        }, 100); // 每100ms检测一次
    }

    // 语音活动检测（保持向后兼容）
    startVoiceActivityDetection() {
        return this.startSmartVoiceActivityDetection();
    }

    // 智能语音检测处理
    handleSmartVoiceDetected() {
        this.silenceFrameCount = 0;
        
        if (!this.isVoiceActive) {
            this.isVoiceActive = true;
            
            // 如果没有活跃分段，开始新分段
            if (!this.isRecording) {
                this.startNewSegment();
            }
            
            if (this.onVoiceDetected) {
                this.onVoiceDetected();
            }
        }
        
        // 更新最后语音时间
        this.currentSegment.lastVoiceTime = Date.now();
    }

    // 智能静音检测处理
    handleSmartSilenceDetected() {
        this.silenceFrameCount++;
        
        if (this.isVoiceActive && this.silenceFrameCount >= this.segmentConfig.consecutiveSilenceFrames) {
            this.isVoiceActive = false;
            
            // 检查是否应该结束当前分段
            if (this.isRecording && this.shouldFinishSegment()) {
                this.finishCurrentSegment();
            }
            
            if (this.onSilenceDetected) {
                this.onSilenceDetected();
            }
        }
    }

    // 传统语音检测处理（保持向后兼容）
    handleVoiceDetected() {
        return this.handleSmartVoiceDetected();
    }

    handleSilenceDetected() {
        return this.handleSmartSilenceDetected();
    }

    // 开始新分段
    startNewSegment() {
        this.segmentCounter++;
        const segmentId = `segment_${Date.now()}_${this.segmentCounter}`;
        
        this.currentSegment = {
            chunks: [],
            startTime: Date.now(),
            lastVoiceTime: Date.now(),
            segmentId: segmentId
        };
        
        console.log(`开始新分段: ${segmentId}`);
        
        // 开始录音
        this.startSegmentRecording();
        
        if (this.onSegmentStart) {
            this.onSegmentStart(segmentId);
        }
    }

    // 开始分段录音
    async startSegmentRecording() {
        if (this.isRecording) {
            console.log('已经在录音中，跳过启动');
            return;
        }

        if (!this.stream) {
            await this.initialize();
        }

        // 确保分段数据容器已初始化
        if (!this.currentSegment.chunks) {
            this.currentSegment.chunks = [];
        }
        
        try {
            // 创建 MediaRecorder
            this.mediaRecorder = new MediaRecorder(this.stream, {
                mimeType: this.getSupportedMimeType()
            });

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.currentSegment.chunks.push(event.data);
                    console.log(`收集音频数据: ${event.data.size} bytes, 总块数: ${this.currentSegment.chunks.length}`);
                }
            };

            this.mediaRecorder.onstop = () => {
                console.log(`分段录音停止: ${this.currentSegment.segmentId}, 总音频块: ${this.currentSegment.chunks.length}`);
            };

            this.mediaRecorder.onerror = (event) => {
                console.error('分段录音错误:', event.error);
            };

            // 每100ms收集一次数据，提高分段精度
            this.mediaRecorder.start(100);
            this.isRecording = true;
            
            console.log(`分段录音开始: ${this.currentSegment.segmentId}`);
            
        } catch (error) {
            console.error('启动分段录音失败:', error);
            throw error;
        }
    }

    // 检查是否应该完成分段
    shouldFinishSegment() {
        if (!this.currentSegment.startTime) return false;
        
        const now = Date.now();
        const segmentDuration = now - this.currentSegment.startTime;
        const timeSinceLastVoice = now - this.currentSegment.lastVoiceTime;
        
        // 分段完成条件：
        // 1. 达到最小时长且检测到足够长的停顿
        // 2. 达到最大时长
        return (segmentDuration >= this.segmentConfig.minSegmentDuration && 
                timeSinceLastVoice >= this.segmentConfig.pauseDetectionTime) ||
               segmentDuration >= this.segmentConfig.maxSegmentDuration;
    }

    // 完成当前分段
    async finishCurrentSegment() {
        if (!this.isRecording || this.currentSegment.chunks.length === 0) {
            return;
        }

        const segmentId = this.currentSegment.segmentId;
        const segmentDuration = Date.now() - this.currentSegment.startTime;
        
        console.log(`完成分段: ${segmentId}, 时长: ${segmentDuration}ms`);

        // 停止录音并创建音频blob
        const audioBlob = await this.stopSegmentRecording();
        
        if (audioBlob && audioBlob.size > 0) {
            // 检查分段是否满足最小时长要求
            if (segmentDuration >= this.segmentConfig.minSegmentDuration) {
                console.log(`分段 ${segmentId} 符合要求，准备处理，音频大小: ${audioBlob.size} bytes`);
                
                if (this.onSegmentReady) {
                    this.onSegmentReady(audioBlob, segmentId, segmentDuration);
                }
                
                // 保持向后兼容
                if (this.onAudioReady) {
                    this.onAudioReady(audioBlob);
                }
            } else {
                console.log(`分段 ${segmentId} 时长过短 (${segmentDuration}ms)，跳过处理`);
            }
        } else {
            console.log(`分段 ${segmentId} 音频数据为空，跳过处理`);
        }
        
        if (this.onSegmentEnd) {
            this.onSegmentEnd(segmentId, segmentDuration);
        }
        
        // 重置当前分段
        this.resetCurrentSegment();
        
        // 如果还在连续模式且检测到语音活动，立即开始新分段
        if (this.isContinuousMode && this.isVoiceActive) {
            console.log('检测到持续语音活动，立即开始新分段');
            this.startNewSegment();
        }
    }

    // 停止分段录音
    async stopSegmentRecording() {
        if (!this.isRecording || !this.mediaRecorder) {
            return null;
        }

        return new Promise((resolve) => {
            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.currentSegment.chunks, { 
                    type: this.getSupportedMimeType() 
                });
                
                this.isRecording = false;
                
                console.log(`分段录音完成，音频大小: ${audioBlob.size} bytes`);
                resolve(audioBlob);
            };

            this.mediaRecorder.stop();
        });
    }

    // 重置当前分段
    resetCurrentSegment() {
        this.currentSegment = {
            chunks: [],
            startTime: null,
            lastVoiceTime: null,
            segmentId: null
        };
        this.isVoiceActive = false;
        this.silenceFrameCount = 0;
    }

    // 检查分段时长限制
    checkSegmentDurationLimits() {
        if (!this.isRecording || !this.currentSegment.startTime) {
            return;
        }
        
        const segmentDuration = Date.now() - this.currentSegment.startTime;
        
        // 如果达到最大分段时长，强制完成分段
        if (segmentDuration >= this.segmentConfig.maxSegmentDuration) {
            console.log(`分段达到最大时长限制，强制完成: ${this.currentSegment.segmentId}`);
            this.finishCurrentSegment();
        }
    }

    async stopRecording() {
        if (!this.isRecording || !this.mediaRecorder) {
            console.log('没有正在进行的录音');
            return null;
        }

        return new Promise((resolve) => {
            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { 
                    type: this.getSupportedMimeType() 
                });
                
                this.isRecording = false;
                this.audioChunks = [];
                
                console.log('录音完成，音频大小:', audioBlob.size, 'bytes');
                resolve(audioBlob);
            };

            this.mediaRecorder.stop();
        });
    }

    getSupportedMimeType() {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/wav'
        ];

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }

        return 'audio/webm'; // 默认格式
    }

    cleanup() {
        this.stopContinuousRecording();
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.analyser = null;
        this.microphone = null;
        this.dataArray = null;
    }

    // 设置智能分段参数
    setSegmentConfig(config) {
        this.segmentConfig = { ...this.segmentConfig, ...config };
        console.log('分段配置已更新:', this.segmentConfig);
    }

    // 设置语音活动检测参数（保持向后兼容）
    setVADSettings(silenceThreshold = 30, silenceTimeout = 2000, minRecordingTime = 1000) {
        this.segmentConfig.silenceThreshold = silenceThreshold;
        this.segmentConfig.pauseDetectionTime = silenceTimeout;
        this.segmentConfig.minSegmentDuration = minRecordingTime;
    }

    // 设置智能分段回调函数
    setSmartCallbacks(callbacks) {
        const {
            onVoiceDetected,
            onSilenceDetected,
            onSegmentReady,
            onSegmentStart,
            onSegmentEnd,
            onAudioReady // 保持向后兼容
        } = callbacks;
        
        this.onVoiceDetected = onVoiceDetected;
        this.onSilenceDetected = onSilenceDetected;
        this.onSegmentReady = onSegmentReady;
        this.onSegmentStart = onSegmentStart;
        this.onSegmentEnd = onSegmentEnd;
        
        // 保持向后兼容
        if (onAudioReady) {
            this.onAudioReady = onAudioReady;
        }
    }

    // 设置回调函数（保持向后兼容）
    setCallbacks(onVoiceDetected, onSilenceDetected, onAudioReady) {
        this.onVoiceDetected = onVoiceDetected;
        this.onSilenceDetected = onSilenceDetected;
        this.onAudioReady = onAudioReady;
    }

    // 获取当前分段状态
    getSegmentStatus() {
        return {
            isRecording: this.isRecording,
            isContinuousMode: this.isContinuousMode,
            currentSegmentId: this.currentSegment.segmentId,
            segmentDuration: this.currentSegment.startTime ? 
                Date.now() - this.currentSegment.startTime : 0,
            segmentCounter: this.segmentCounter,
            isVoiceActive: this.isVoiceActive,
            silenceFrameCount: this.silenceFrameCount
        };
    }

    // 检查麦克风权限状态
    async checkPermission() {
        if (!navigator.permissions) {
            return 'unknown';
        }

        try {
            const permission = await navigator.permissions.query({ name: 'microphone' });
            return permission.state; // 'granted', 'denied', 'prompt'
        } catch (error) {
            console.log('无法查询麦克风权限状态:', error);
            return 'unknown';
        }
    }

    // 检查浏览器支持
    static isSupported() {
        return !!(navigator.mediaDevices && 
                 navigator.mediaDevices.getUserMedia && 
                 window.MediaRecorder);
    }

    // 检查是否在安全环境中
    static isSecureContext() {
        return window.isSecureContext || window.location.protocol === 'https:' || 
               window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    }
}

export default AudioRecorder;