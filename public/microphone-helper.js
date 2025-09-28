class MicrophoneHelper {
    static async checkPermissionStatus() {
        if (!navigator.permissions) {
            return { state: 'unknown', message: '浏览器不支持权限查询' };
        }

        try {
            const permission = await navigator.permissions.query({ name: 'microphone' });
            return {
                state: permission.state,
                message: this.getPermissionMessage(permission.state)
            };
        } catch (error) {
            return { state: 'unknown', message: '无法查询麦克风权限状态' };
        }
    }

    static getPermissionMessage(state) {
        switch (state) {
            case 'granted':
                return '麦克风权限已授予';
            case 'denied':
                return '麦克风权限被拒绝，请在浏览器设置中允许访问';
            case 'prompt':
                return '需要请求麦克风权限';
            default:
                return '权限状态未知';
        }
    }

    static async requestPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            // 立即停止流，我们只是为了获取权限
            stream.getTracks().forEach(track => track.stop());
            
            return { success: true, message: '麦克风权限获取成功' };
        } catch (error) {
            return {
                success: false,
                error: error.name,
                message: this.getErrorMessage(error)
            };
        }
    }

    static getErrorMessage(error) {
        switch (error.name) {
            case 'NotAllowedError':
                return '用户拒绝了麦克风权限请求。请点击地址栏的麦克风图标或查看权限设置帮助。';
            case 'NotFoundError':
                return '未找到麦克风设备。请检查麦克风是否正确连接。';
            case 'NotReadableError':
                return '麦克风被其他应用占用。请关闭其他使用麦克风的应用后重试。';
            case 'OverconstrainedError':
                return '麦克风不支持所需的音频设置。';
            case 'SecurityError':
                return '安全限制：请确保在 HTTPS 环境下使用，或在 localhost 进行测试。';
            case 'AbortError':
                return '权限请求被中断。';
            default:
                return `麦克风访问失败: ${error.message}`;
        }
    }

    static checkBrowserSupport() {
        const issues = [];

        if (!navigator.mediaDevices) {
            issues.push('浏览器不支持 MediaDevices API');
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            issues.push('浏览器不支持 getUserMedia');
        }

        if (!window.MediaRecorder) {
            issues.push('浏览器不支持 MediaRecorder');
        }

        if (!window.isSecureContext && 
            window.location.protocol !== 'https:' && 
            !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
            issues.push('录音功能需要在安全环境(HTTPS)下使用');
        }

        return {
            supported: issues.length === 0,
            issues: issues
        };
    }

    static getBrowserInfo() {
        const userAgent = navigator.userAgent;
        let browser = 'Unknown';
        
        if (userAgent.includes('Chrome')) browser = 'Chrome';
        else if (userAgent.includes('Firefox')) browser = 'Firefox';
        else if (userAgent.includes('Safari')) browser = 'Safari';
        else if (userAgent.includes('Edge')) browser = 'Edge';
        
        return {
            name: browser,
            userAgent: userAgent,
            isSecure: window.isSecureContext,
            protocol: window.location.protocol
        };
    }

    static async getDeviceInfo() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            
            return {
                totalDevices: devices.length,
                audioInputs: audioInputs.length,
                devices: audioInputs.map(device => ({
                    deviceId: device.deviceId,
                    label: device.label || '未知设备',
                    groupId: device.groupId
                }))
            };
        } catch (error) {
            return {
                error: error.message,
                totalDevices: 0,
                audioInputs: 0,
                devices: []
            };
        }
    }
}

export default MicrophoneHelper;