import { supabase } from '../lib/supabase';
import type { Word } from './resegment';

export interface UsageStatus {
  accessMode: 'metered' | 'unlimited';
  isUnlimited: boolean;
  subscriptionStatus: 'none' | 'active' | 'grace' | 'expired' | 'revoked';
  subscriptionProductId: string | null;
  subscriptionExpiresAt: string | null;
  grantedSeconds: number;
  consumedSeconds: number;
  reservedSeconds: number;
  availableSeconds: number | null;
  trialAvailableSeconds: number;
}

interface RawUsageStatus {
  access_mode: UsageStatus['accessMode'];
  is_unlimited: boolean;
  subscription_status: UsageStatus['subscriptionStatus'];
  subscription_product_id: string | null;
  subscription_expires_at: string | null;
  granted_seconds: number;
  consumed_seconds: number;
  reserved_seconds: number;
  available_seconds: number | null;
  trial_available_seconds: number;
}

function mapUsageStatus(raw: RawUsageStatus): UsageStatus {
  return {
    accessMode: raw.access_mode,
    isUnlimited: raw.is_unlimited,
    subscriptionStatus: raw.subscription_status,
    subscriptionProductId: raw.subscription_product_id,
    subscriptionExpiresAt: raw.subscription_expires_at,
    grantedSeconds: raw.granted_seconds,
    consumedSeconds: raw.consumed_seconds,
    reservedSeconds: raw.reserved_seconds,
    availableSeconds: raw.available_seconds,
    trialAvailableSeconds: raw.trial_available_seconds,
  };
}

export async function ensureTrialAndGetUsage(): Promise<UsageStatus> {
  const { error: claimError } = await supabase.rpc('claim_stt_trial');
  if (claimError) throw new Error(claimError.message);
  return getUsageStatus();
}

export async function getUsageStatus(): Promise<UsageStatus> {
  const { data, error } = await supabase.rpc('get_stt_usage_status');
  if (error) throw new Error(error.message);
  return mapUsageStatus(data as RawUsageStatus);
}

async function edgeErrorData(error: any): Promise<any> {
  try {
    const response = error?.context;
    if (response && typeof response.clone === 'function') return await response.clone().json();
    if (response && typeof response.json === 'function') return await response.json();
  } catch {}
  return null;
}

async function invokeSttBatch(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('stt-batch', { body });
  if (!error) return data;

  const details = await edgeErrorData(error);
  if (details?.error === 'QUOTA_EXCEEDED') {
    const available = Math.floor((details.availableSeconds || 0) / 60);
    const required = Math.ceil((details.requiredSeconds || 0) / 60);
    const quotaError = new Error(`语音额度不足：剩余 ${available} 分钟，本次需要 ${required} 分钟`);
    (quotaError as any).code = 'QUOTA_EXCEEDED';
    (quotaError as any).details = details;
    throw quotaError;
  }
  if (details?.error === 'FILE_DURATION_LIMIT') {
    throw new Error(`当前账号单个文件最多识别 ${Math.floor(details.maxFileSeconds / 60)} 分钟`);
  }
  throw new Error(details?.error || error.message || '云端识别服务调用失败');
}

export async function submitMeteredAzureBatch(
  audioUrl: string,
  fileId: string,
  requestKey: string,
): Promise<{ jobId: string; durationSeconds: number; isUnlimited: boolean }> {
  const data = await invokeSttBatch({ action: 'submit', audioUrl, fileId, requestKey });
  return {
    jobId: data.jobId,
    durationSeconds: data.durationSeconds,
    isUnlimited: Boolean(data.isUnlimited),
  };
}

export async function waitForMeteredAzureBatch(
  jobId: string,
  onProgress?: (message: string) => void,
): Promise<Word[]> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const data = await invokeSttBatch({ action: 'status', jobId });
    if (data.status === 'succeeded') {
      const words = Array.isArray(data.words) ? data.words as Word[] : [];
      if (!words.length) throw new Error('Azure 没有识别到任何语音内容');
      return words;
    }
    if (data.status === 'failed' || data.status === 'released') {
      throw new Error(data.error || 'Azure 识别失败，额度已返还');
    }
    onProgress?.(`云端识别中...（${attempt * 5}s）`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error('Azure Batch 识别超时，任务仍会在后台对账，请稍后重试');
}

export function formatUsageMinutes(seconds: number | null): string {
  if (seconds === null) return '不限时长';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}
