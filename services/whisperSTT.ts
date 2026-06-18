import RNFS from '@dr.pogodin/react-native-fs';
import { GROQ_API_KEY } from '../constants/api';
const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

export async function whisperSTT(fileUri: string): Promise<string> {
  // Check file exists
  const exists = await RNFS.exists(fileUri);
  if (!exists) throw new Error('Recording file not found');

  const base64 = await RNFS.readFile(fileUri, 'base64');

  // Build form data manually since RN FormData has limitations
  const boundary = '----WhisperBoundary' + Date.now();
  const filename = 'recording.wav';
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: audio/wav',
    '',
    base64,
    `--${boundary}`,
    'Content-Disposition: form-data; name="model"',
    '',
    'whisper-large-v3',
    `--${boundary}`,
    'Content-Disposition: form-data; name="language"',
    '',
    'ko',
    `--${boundary}--`,
  ].join('\r\n');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Whisper STT error: ${response.status}`);
  }

  const data = await response.json();
  return data.text as string;
}
