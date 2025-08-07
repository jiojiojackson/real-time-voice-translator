
import { useState, useRef, useCallback, useEffect } from 'react';

// The types for SpeechRecognition are defined globally in `types.ts`.
// We use a different name for the constructor value to avoid shadowing the type name.
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

interface UseSpeechRecognitionOptions {
  onTranscriptSegment: (segment: string) => void;
  onError?: (error: string) => void;
}

export const useSpeechRecognition = ({ onTranscriptSegment, onError }: UseSpeechRecognitionOptions) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Use the 'SpeechRecognition' interface (from global types) as the type for the ref.
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      const msg = "Speech recognition not supported.";
      setError(msg);
      onError?.(msg);
      return;
    }
    if (recognitionRef.current) return; // Already listening

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.lang = 'ja-JP'; // Set language to Japanese
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
        setTranscript('');
        setInterimTranscript('');
        setError(null);
      };

      recognition.onend = () => {
        // If recognitionRef is not null, it means stopListening was not called.
        // This indicates an automatic stop (e.g., timeout, no-speech), so we restart.
        if (recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch(e) {
            // This can happen if the page is backgrounded and not allowed to start mic
            console.error("Could not restart speech recognition", e);
            const msg = "Could not restart microphone.";
            setError(msg);
            onError?.(msg);
            if (recognitionRef.current) {
                recognitionRef.current.onend = null;
                recognitionRef.current = null;
            }
            setIsListening(false);
          }
        } else {
          setIsListening(false); // Manually stopped.
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === 'no-speech') {
            // This is a common event, we let onend handle the restart.
            return;
        } 
        
        let errorMessage = `Speech error: ${event.error}`;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            errorMessage = 'Microphone access denied.';
            // Prevent restart loop if permissions are denied
            if (recognitionRef.current) {
                recognitionRef.current.onend = null; // remove restart handler
                recognitionRef.current = null;
            }
            setIsListening(false);
        }
        
        setError(errorMessage);
        onError?.(errorMessage);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = '';
        let currentInterim = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            currentInterim += result[0].transcript;
          }
        }
        
        setInterimTranscript(currentInterim);
        if (finalTranscript.trim()) {
          setTranscript(prev => prev + finalTranscript);
          onTranscriptSegment(finalTranscript);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (e: any) {
        const msg = `Could not start recognition: ${e.message}`;
        setError(msg);
        onError?.(msg);
    }

  }, [onTranscriptSegment, onError]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      // Set onend to null before stopping to prevent the restart logic from firing.
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null; // This is the signal that we stopped manually.
    }
    setIsListening(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);


  return {
    isListening,
    startListening,
    stopListening,
    transcript,
    interimTranscript,
    error,
  };
};
