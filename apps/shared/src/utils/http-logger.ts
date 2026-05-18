import { promises as fs } from 'fs';
import * as path from 'path';

export interface LoggedRequest {
  method: string;
  url: string;
  endpoint: string;
  headers: Record<string, string>;
  body?: unknown | null;
}

export interface LoggedResponse {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body?: unknown | null;
}

export interface HttpLog {
  timestamp: string;
  durationMs: number;
  context?: string;
  request: LoggedRequest;
  response: LoggedResponse;
}

function normalizeRequestBody(body: unknown, contentType?: string): unknown | null {
  if (body == null) {
    return null;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (typeof body === 'string') {
    const normalized = body.trim();
    if (contentType?.includes('application/json')) {
      try {
        return JSON.parse(normalized);
      } catch {
        return normalized;
      }
    }

    try {
      return JSON.parse(normalized);
    } catch {
      return normalized;
    }
  }

  if (typeof body === 'object') {
    return body;
  }

  return body;
}

function getEndpoint(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function normalizeResponseBody(text: string | null, contentType?: string): unknown | null {
  if (text == null) {
    return null;
  }

  const normalized = text.trim();
  if (!normalized) {
    return null;
  }

  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(normalized);
    } catch {
      return normalized;
    }
  }

  try {
    return JSON.parse(normalized);
  } catch {
    return normalized;
  }
}

export async function loggedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  context?: string,
): Promise<Response> {
  const now = Date.now();
  const start = new Date();
  const timestamp = start.toISOString();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const endpoint = getEndpoint(url);
  const method = init?.method || 'GET';
  const headers = init?.headers instanceof Headers
    ? Object.fromEntries(init.headers.entries())
    : Object.fromEntries(Object.entries(init?.headers || {}));
  const contentType = Object.entries(headers).reduce((type, [key, value]) => {
    if (key.toLowerCase() === 'content-type') {
      return String(value);
    }
    return type;
  }, '');
  const body = normalizeRequestBody(init?.body, contentType);

  const yearMonth = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  const logDir = path.join(process.cwd(), 'logs', 'requests', yearMonth);
  await fs.mkdir(logDir, { recursive: true });

  const fileName = `${timestamp.replace(/[:.]/g, '-')}__${method}.json`;
  const logFile = path.join(logDir, fileName);

  try {
    const response = await fetch(input, init);
    const durationMs = Date.now() - now;

    const clonedResponse = response.clone();
    let responseBody: unknown | null = null;
    try {
      responseBody = normalizeResponseBody(await clonedResponse.text(), response.headers.get('content-type') ?? undefined);
    } catch {
      responseBody = null;
    }

    const loggedResponse: LoggedResponse = {
      statusCode: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
    };

    const log: HttpLog = {
      timestamp,
      durationMs,
      ...(context && { context }),
      request: { method, url, endpoint, headers, body },
      response: loggedResponse,
    };

    await fs.writeFile(logFile, JSON.stringify(log, null, 2), 'utf8');

    return response;
  } catch (error: any) {
    const durationMs = Date.now() - now;
    const loggedResponse: LoggedResponse = {
      statusCode: 0,
      statusText: error?.message ?? String(error),
      headers: {},
      body: null,
    };

    const log: HttpLog = {
      timestamp,
      durationMs,
      ...(context && { context }),
      request: { method, url, endpoint, headers, body },
      response: loggedResponse,
    };

    await fs.writeFile(logFile, JSON.stringify(log, null, 2), 'utf8');

    throw error;
  }
}
