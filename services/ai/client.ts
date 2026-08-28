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
