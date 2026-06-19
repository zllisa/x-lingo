import { CachesDirectoryPath, writeFile } from '@dr.pogodin/react-native-fs';
import { AZURE_TTS_KEY, AZURE_TTS_REGION } from '../constants/api';
const ENDPOINT = `https://${AZURE_TTS_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

function buildSSML(text: string, speed: number = 1): string {
  const rate = speed <= 0.5 ? 'slow' : speed >= 1.5 ? 'fast' : 'medium';
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR">
    <voice name="ko-KR-SunHiNeural">
      <prosody rate="${rate}">${text}</prosody>
    </voice>
  </speak>`;
}

export async function azureTTS(text: string, speed: number = 1): Promise<string> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': AZURE_TTS_KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
    },
    body: buildSSML(text, speed),
  });

  if (!response.ok) {
    throw new Error(`Azure TTS error: ${response.status}`);
  }

  // Write audio to temp file
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  const uri = CachesDirectoryPath + `/tts_${Date.now()}.mp3`;
  await writeFile(uri, base64, 'base64');
  return uri;
}
