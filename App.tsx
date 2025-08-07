import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { translateStream } from './services/geminiService';
import { MicIcon, StopIcon, WindowCloseIcon, ErrorIcon } from './components/Icons';

// Error Log Modal Component
interface ErrorLog {
    timestamp: string;
    message: string;
}

interface ErrorLogModalProps {
  errors: ErrorLog[];
  onClose: () => void;
}

const ErrorLogModal: React.FC<ErrorLogModalProps> = ({ errors, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 p-4" aria-modal="true" role="dialog">
      <div className="w-full max-w-2xl h-[60vh] min-h-[400px] bg-[#C0C0C0] border-t-2 border-l-2 border-white border-b-2 border-r-2 border-black shadow-lg flex flex-col">
        {/* Title Bar */}
        <div className="h-8 bg-gradient-to-r from-[#000080] to-[#1084d0] flex items-center justify-between px-2 select-none">
          <h1 className="text-white font-bold text-sm">Error Log</h1>
          <button onClick={onClose} className="w-6 h-6 bg-[#C0C0C0] border-t border-l border-white border-b border-r border-black flex items-center justify-center active:border-t-2 active:border-l-2 active:border-black active:border-b-2 active:border-r-2 active:border-white">
              <WindowCloseIcon />
          </button>
        </div>
        {/* Content Area */}
        <div className="flex-grow p-2 overflow-hidden">
            <div className="bg-white p-2 border-2 border-black border-t-gray-500 border-l-gray-500 h-full font-mono text-sm overflow-y-auto">
            {errors.length === 0 ? (
                <p className="text-gray-500">No errors recorded.</p>
            ) : (
                <ul>
                {errors.slice().reverse().map((error, index) => (
                    <li key={index} className="border-b border-gray-300 py-1 text-xs">
                      <strong className="text-blue-700">[{error.timestamp}]</strong>: <span className="text-red-700">{error.message}</span>
                    </li>
                ))}
                </ul>
            )}
            </div>
        </div>
      </div>
    </div>
  );
};


export default function App() {
  const [chineseTranslation, setChineseTranslation] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [showErrorLog, setShowErrorLog] = useState(false);
  
  const japanesePanelRef = useRef<HTMLDivElement>(null);
  const chinesePanelRef = useRef<HTMLDivElement>(null);

  const addErrorLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setErrors(prev => [...prev, { timestamp, message }]);
  }, []);

  const handleNewTranscriptSegment = useCallback(async (segment: string) => {
    if (!segment.trim()) return;

    setIsTranslating(true);
    try {
      const stream = await translateStream(segment);
      for await (const chunk of stream) {
        const chunkText = chunk.text || ''; // Fix: Ensure chunkText is not undefined
        setChineseTranslation(prev => prev + chunkText);
      }
      setChineseTranslation(prev => prev + '\n');
    } catch (error) {
      console.error("Translation error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      addErrorLog(`Translation error: ${errorMessage}`);
      setChineseTranslation(prev => prev + '[Translation Error]\n');
    } finally {
      setIsTranslating(false);
    }
  }, [addErrorLog]);
  
  const onSpeechError = useCallback((message: string) => {
    addErrorLog(message);
  }, [addErrorLog]);

  const {
    isListening,
    startListening,
    stopListening,
    transcript,
    interimTranscript,
    error,
  } = useSpeechRecognition({ 
      onTranscriptSegment: handleNewTranscriptSegment,
      onError: onSpeechError,
  });


  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      setChineseTranslation('');
      setErrors([]); // Clear errors on new session
      startListening();
    }
  };

  useEffect(() => {
    const panel = japanesePanelRef.current;
    if (panel) {
      // Only auto-scroll if the user is already near the bottom.
      // This prevents interrupting the user if they have scrolled up.
      const isScrolledToBottom = panel.scrollHeight - panel.scrollTop <= panel.clientHeight + 50;
      if (isScrolledToBottom) {
        panel.scrollTop = panel.scrollHeight;
      }
    }
  }, [transcript, interimTranscript]);

  useEffect(() => {
    const panel = chinesePanelRef.current;
    if (panel) {
      // Same smart scrolling logic for the Chinese panel.
      const isScrolledToBottom = panel.scrollHeight - panel.scrollTop <= panel.clientHeight + 50;
      if (isScrolledToBottom) {
        panel.scrollTop = panel.scrollHeight;
      }
    }
  }, [chineseTranslation]);

  return (
    <div className="min-h-screen bg-[#008080] flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-4xl h-[70vh] min-h-[500px] bg-[#C0C0C0] border-t-2 border-l-2 border-white border-b-2 border-r-2 border-black shadow-lg flex flex-col">
        {/* Title Bar */}
        <div className="h-8 bg-gradient-to-r from-[#000080] to-[#1084d0] flex items-center justify-between px-2 select-none">
          <h1 className="text-white font-bold text-sm">リアルタイム翻訳 (Real-time Translator)</h1>
        </div>

        {/* Content Area */}
        <div className="flex-grow p-4 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden">
          {/* Japanese Panel */}
          <div className="flex flex-col h-full min-h-0">
            <p className="mb-2 font-semibold">日本語 (Japanese Input)</p>
            <div ref={japanesePanelRef} className="flex-grow bg-white text-black font-mono p-3 border-2 border-black border-t-gray-500 border-l-gray-500 overflow-y-auto">
              <p>
                {transcript}
                <span className="text-gray-500">{interimTranscript}</span>
              </p>
              {!isListening && !transcript && <p className="text-gray-500">Press "Start" to begin transcription...</p>}
            </div>
          </div>

          {/* Chinese Panel */}
          <div className="flex flex-col h-full min-h-0">
            <p className="mb-2 font-semibold">中国語 (Chinese Translation)</p>
            <div ref={chinesePanelRef} className="flex-grow bg-white text-black font-mono p-3 border-2 border-black border-t-gray-500 border-l-gray-500 overflow-y-auto whitespace-pre-wrap">
              <p>{chineseTranslation}</p>
              {isTranslating && chineseTranslation && !chineseTranslation.endsWith('\n') && <span className="inline-block w-2 h-4 bg-black animate-pulse ml-1"></span>}
              {!isTranslating && !chineseTranslation && <p className="text-gray-500">Translation will appear here...</p>}
            </div>
          </div>
        </div>
        
        {/* Status Bar */}
        <div className="h-16 border-t-2 border-white p-2 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            {/* Left Col: Error Log */}
            <div className="flex justify-start">
              <button
                  onClick={() => setShowErrorLog(true)}
                  className="bg-[#C0C0C0] border-t-2 border-l-2 border-white border-b-2 border-r-2 border-black flex items-center justify-center px-3 py-1 space-x-2 text-sm font-bold focus:outline-none active:border-t-2 active:border-l-2 active:border-black active:border-b-2 active:border-r-2 active:border-white"
                  aria-label={`Open Error Log. ${errors.length} errors recorded.`}
              >
                  <ErrorIcon />
                  <span>Log ({errors.length})</span>
              </button>
            </div>

            {/* Center Col: Main Button */}
            <div className="flex justify-center">
              <button
                onClick={toggleListening}
                className="w-48 h-10 bg-[#C0C0C0] border-t-2 border-l-2 border-white border-b-2 border-r-2 border-black flex items-center justify-center space-x-3 text-lg font-bold focus:outline-none active:border-t-2 active:border-l-2 active:border-black active:border-b-2 active:border-r-2 active:border-white disabled:opacity-50"
                disabled={!!error && !isListening}
              >
                {isListening ? (
                  <>
                    <StopIcon />
                    <span>Stop</span>
                  </>
                ) : (
                  <>
                    <MicIcon />
                    <span>Start</span>
                  </>
                )}
              </button>
            </div>
            
            {/* Right Col: Status Panel */}
            <div className="flex justify-end">
              <div className="border border-t-gray-500 border-l-gray-500 border-b-white border-r-white p-2 text-sm truncate max-w-full">
                {error ? <span className="text-red-600 font-semibold">{error}</span> : <span>{isListening ? 'Listening...' : 'Ready'}</span>}
              </div>
            </div>
        </div>
      </div>
      {showErrorLog && <ErrorLogModal errors={errors} onClose={() => setShowErrorLog(false)} />}
    </div>
  );
}