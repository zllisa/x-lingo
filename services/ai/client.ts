import { getProviderChain } from './providers';

const REQUEST_TIMEOUT_MS = 12_000;

interface AIRequestInit extends RequestInit {
  timeoutMs?: number;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Send one OpenAI-compatible request, with an optional provider fallback. */
export async function requestAI(init: AIRequestInit): Promise<Response> {
  const providers = getProviderChain();
  if (!providers.length) throw new Error('AI API Key 未配置，请检查当前提供商配置');

  const originalBody = typeof init.body === 'string' ? JSON.parse(init.body) : {};
  const { model: _model, reasoning_effort: _reasoningEffort, ...taskBody } = originalBody;
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...requestInit } = init;
  let lastFailure: unknown;

  for (const provider of providers) {
    try {
      const response = await fetchWithTimeout(`${provider.baseURL}/chat/completions`, {
        ...requestInit,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          ...taskBody,
          model: provider.model,
          ...provider.requestOverrides,
        }),
      }, timeoutMs);

      if (response.ok || (response.status < 429 && response.status !== 408)) return response;
      lastFailure = new Error(`${provider.id} error: ${response.status}`);
    } catch (error) {
      lastFailure = error;
    }
  }

  throw lastFailure instanceof Error ? lastFailure : new Error('AI服务暂时不可用');
}

/** Stream OpenAI-compatible chat deltas with connection, idle and total timeouts. */
export async function requestAIStream(
  init: AIRequestInit,
  onDelta: (content: string) => void,
): Promise<void> {
  const providers = getProviderChain();
  if (!providers.length) throw new Error('AI API Key 未配置，请检查当前提供商配置');

  const originalBody = typeof init.body === 'string' ? JSON.parse(init.body) : {};
  const { model: _model, reasoning_effort: _reasoningEffort, ...taskBody } = originalBody;
  let lastFailure: unknown;

  for (const provider of providers) {
    let providerEmitted = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let consumedLength = 0;
        let sseBuffer = '';
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        let abortReason = '';
        const cleanup = () => {
          clearTimeout(connectionTimer);
          clearTimeout(totalTimer);
          if (idleTimer) clearTimeout(idleTimer);
        };
        const abortWith = (message: string) => {
          abortReason = message;
          xhr.abort();
        };
        const connectionTimer = setTimeout(() => abortWith('AI连接超时'), REQUEST_TIMEOUT_MS);
        const totalTimer = setTimeout(() => abortWith('AI讲解超过120秒'), 120_000);
        const refreshIdleTimeout = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => abortWith('AI流式响应超过30秒无数据'), 30_000);
        };
        const acceptSseLine = (line: string) => {
          if (!line.startsWith('data:')) return;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') return;
          try {
            const event = JSON.parse(payload);
            const content = event.choices?.[0]?.delta?.content;
            if (typeof content === 'string' && content) {
              providerEmitted = true;
              onDelta(content);
            }
          } catch {}
        };
        const consumeResponse = (flush = false) => {
          let responseText = '';
          try { responseText = xhr.responseText || ''; } catch { return; }
          if (responseText.length <= consumedLength && !flush) return;
          sseBuffer += responseText.slice(consumedLength);
          consumedLength = responseText.length;
          const lines = sseBuffer.split(/\r?\n/);
          sseBuffer = lines.pop() || '';
          lines.forEach(acceptSseLine);
          if (flush && sseBuffer.trim()) {
            acceptSseLine(sseBuffer);
            sseBuffer = '';
          }
        };

        xhr.open(init.method || 'POST', `${provider.baseURL}/chat/completions`, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('Authorization', `Bearer ${provider.apiKey}`);
        xhr.onreadystatechange = () => {
          if (xhr.readyState >= 2) clearTimeout(connectionTimer);
        };
        xhr.onprogress = () => {
          clearTimeout(connectionTimer);
          refreshIdleTimeout();
          consumeResponse();
        };
        xhr.onload = () => {
          cleanup();
          consumeResponse(true);
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`${provider.id} error: ${xhr.status}`));
        };
        xhr.onerror = () => { cleanup(); reject(new Error(`${provider.id} 网络请求失败`)); };
        xhr.onabort = () => { cleanup(); reject(new Error(abortReason || `${provider.id} 请求已中止`)); };
        xhr.send(JSON.stringify({
          ...taskBody,
          model: provider.model,
          ...provider.requestOverrides,
          stream: true,
        }));
      });
      return;
    } catch (error) {
      if (providerEmitted) throw error;
      lastFailure = error;
    }
  }

  throw lastFailure instanceof Error ? lastFailure : new Error('AI流式服务暂时不可用');
}
