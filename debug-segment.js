#!/usr/bin/env node

/**
 * 调试智能分段功能
 * 测试分段处理的各个环节
 */

import dotenv from 'dotenv';
import VoiceService from './voice-service.js';
import fs from 'fs';

// 加载环境变量
dotenv.config();

console.log('🔍 开始调试智能分段功能...');

// 创建语音服务实例
const voiceService = new VoiceService(process.env.GROQ_API_KEY || 'test-key');

// 监听事件
voiceService.on('segmentTranscribed', (data) => {
    console.log('✅ 转录完成事件:', data);
});

voiceService.on('segmentTranslated', (data) => {
    console.log('✅ 翻译完成事件:', data);
});

voiceService.on('segmentError', (data) => {
    console.log('❌ 处理错误事件:', data);
});

// 测试队列状态
console.log('📊 初始队列状态:', voiceService.getQueueStatus());

// 创建测试音频文件（如果不存在）
const testAudioPath = './test-audio.webm';
if (!fs.existsSync(testAudioPath)) {
    console.log('⚠️  测试音频文件不存在，创建空文件用于测试');
    // 创建一个最小的 WebM 文件头
    const webmHeader = Buffer.from([
        0x1A, 0x45, 0xDF, 0xA3, // EBML header
        0x9F, 0x42, 0x86, 0x81, 0x01, // DocType: webm
        0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6D // "webm"
    ]);
    fs.writeFileSync(testAudioPath, webmHeader);
}

// 测试添加分段到队列
console.log('📤 测试添加分段到转录队列...');
const segmentInfo = voiceService.addAudioSegmentFromFile(
    testAudioPath,
    'test-session-1',
    'test-segment-1',
    'en',
    'zh'
);

console.log('📋 分段信息:', segmentInfo);

// 检查队列状态
setTimeout(() => {
    console.log('📊 处理后队列状态:', voiceService.getQueueStatus());
}, 1000);

// 等待处理完成
setTimeout(() => {
    console.log('🏁 调试完成');
    
    // 清理测试文件
    if (fs.existsSync(testAudioPath)) {
        fs.unlinkSync(testAudioPath);
        console.log('🧹 清理测试文件');
    }
    
    process.exit(0);
}, 5000);