// 演示新功能的测试脚本
// 这个脚本可以用来测试追加显示和异步数据库保存功能

import Database from './database.js';

async function testDatabaseOperations() {
    console.log('🧪 开始测试数据库操作...');
    
    const db = new Database();
    
    try {
        // 测试保存多个对话
        console.log('📝 保存测试对话...');
        
        const conversations = [
            {
                original: 'Hello, how are you?',
                translated: '你好，你好吗？',
                sourceLang: 'en',
                targetLang: 'zh'
            },
            {
                original: 'I am fine, thank you.',
                translated: '我很好，谢谢你。',
                sourceLang: 'en',
                targetLang: 'zh'
            },
            {
                original: '今天天气很好。',
                translated: 'The weather is very nice today.',
                sourceLang: 'zh',
                targetLang: 'en'
            }
        ];
        
        for (const conv of conversations) {
            const id = await db.saveConversation(
                conv.original,
                conv.translated,
                conv.sourceLang,
                conv.targetLang
            );
            console.log(`✅ 保存对话 ID: ${id}`);
            
            // 模拟异步保存的延迟
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // 测试获取历史记录
        console.log('📚 获取历史记录...');
        const history = await db.getConversations(10);
        
        console.log(`📊 找到 ${history.length} 条历史记录:`);
        history.forEach((record, index) => {
            console.log(`${index + 1}. [${record.timestamp}] ${record.original_text} -> ${record.translated_text}`);
        });
        
        console.log('✅ 数据库测试完成');
        
    } catch (error) {
        console.error('❌ 数据库测试失败:', error);
    } finally {
        db.close();
    }
}

// 运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
    testDatabaseOperations();
}

export { testDatabaseOperations };