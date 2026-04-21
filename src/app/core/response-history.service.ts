import { Injectable } from '@angular/core';
import { Response } from '../../shared/response';
import type {
  ResponseHistoryEntryInput,
  ResponseHistoryFullEntry,
  ResponseHistoryListItem
} from '../../shared/electron';

@Injectable({ providedIn: 'root' })
export class ResponseHistoryService {
  private get api() {
    return (typeof window !== 'undefined' ? (window as any).awElectron : null) || null;
  }

  async append(requestId: string, response: Response): Promise<number | null> {
    if (!this.api?.historyAppend) return null;
    const entry: ResponseHistoryEntryInput = {
      requestId,
      receivedAt: response.receivedAt instanceof Date
        ? response.receivedAt.getTime()
        : Number(response.receivedAt) || Date.now(),
      statusCode: response.statusCode,
      statusText: response.statusText,
      timeMs: response.timeMs,
      size: response.size,
      httpVersion: response.httpVersion,
      contentType: response.contentType,
      headers: response.headers?.map(h => ({ key: h.key, value: h.value })) ?? [],
      body: response.isBinary ? '' : (response.body ?? ''),
      isBinary: !!response.isBinary,
    };
    try {
      return await this.api.historyAppend(entry);
    } catch {
      return null;
    }
  }

  async list(requestId: string, limit = 20): Promise<ResponseHistoryListItem[]> {
    if (!this.api?.historyList) return [];
    try {
      return await this.api.historyList(requestId, limit);
    } catch {
      return [];
    }
  }

  async get(id: number): Promise<ResponseHistoryFullEntry | null> {
    if (!this.api?.historyGet) return null;
    try {
      return await this.api.historyGet(id);
    } catch {
      return null;
    }
  }

  async clear(requestId: string): Promise<boolean> {
    if (!this.api?.historyClear) return false;
    try {
      return await this.api.historyClear(requestId);
    } catch {
      return false;
    }
  }
}
