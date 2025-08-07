// Helper function to process the streaming response from the backend
async function* streamText(response: Response): AsyncGenerator<{ text: string }> {
  if (!response.body) {
    throw new Error("Response body is null");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    // The backend streams text chunks directly
    const text = decoder.decode(value, { stream: true });
    yield { text };
  }
}

export async function translateStream(japaneseText: string) {
  try {
    // Call our own backend API route instead of Google's API directly
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ japaneseText }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Try to parse as JSON, but fall back to raw text if it fails
      let errorMessage = errorText;
      try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || 'An unknown API error occurred';
      } catch (e) {
          // It wasn't JSON, use the raw text.
      }
      throw new Error(`API error: ${response.status} ${response.statusText} - ${errorMessage}`);
    }

    return streamText(response);

  } catch (error) {
    console.error("Translation service call failed:", error);
    throw error; // Re-throw the original error to be caught by the UI
  }
}
