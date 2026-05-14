export const getTaskNotificationWebhookUrl = (): string =>
  String(process.env.TASK_NOTIFICATION_WEBHOOK_URL ?? '').trim();

export const getTaskNotificationWebhookKey = (): string =>
  String(process.env.TASK_NOTIFICATION_WEBHOOK_KEY ?? '').trim();

export const getTaskNotificationDownloadBaseUrl = (): string =>
  String(process.env.TASK_NOTIFICATION_DOWNLOAD_BASE_URL ?? '').trim();

export const isTaskNotificationEnabled = (): boolean =>
  getTaskNotificationWebhookUrl().length > 0;

export const tryDecodeTaskNotificationWebhookKey = (rawKey: string): string => {
  if (!rawKey.includes('%')) {
    return rawKey;
  }

  try {
    return decodeURIComponent(rawKey);
  } catch {
    return rawKey;
  }
};

export const getTaskNotificationAuthHeaders = (
  key: string,
): Record<string, string> => {
  if (!key) {
    return {};
  }

  return {
    'X-Task-Notification-Key': key,
    'x-api-key': key,
    Authorization: `Bearer ${key}`,
  };
};
