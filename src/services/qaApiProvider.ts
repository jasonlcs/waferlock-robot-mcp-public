import { QAEntry } from '../types.js';
import { QAProvider } from './qaProvider.js';

type ApiQAEntry = Omit<QAEntry, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

type ListResponse = {
  entries: ApiQAEntry[];
};

type DetailResponse = {
  entry: ApiQAEntry;
};

function toQaEntry(entry: ApiQAEntry): QAEntry {
  return {
    ...entry,
    createdAt: new Date(entry.createdAt),
    updatedAt: new Date(entry.updatedAt),
  };
}

export function createQAApiProvider(apiUrl: string, apiToken: string): QAProvider {
  const baseUrl = apiUrl.replace(/\/$/, '');

  if (!apiToken) {
    throw new Error('API token is required to initialise the QA API provider');
  }

  async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiToken}`,
        ...(init?.headers ?? {}),
      },
      ...init,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`QA API request failed (${response.status} ${response.statusText}): ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async function apiRequestOptional(path: string): Promise<DetailResponse | undefined> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
    });

    if (response.status === 404) {
      return undefined;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`QA API request failed (${response.status} ${response.statusText}): ${text}`);
    }

    return (await response.json()) as DetailResponse;
  }

  return {
    async listEntries(filter) {
      const params = new URLSearchParams();
      if (filter?.category) {
        params.set('category', filter.category);
      }
      if (filter?.search) {
        params.set('search', filter.search);
      }
      const path = params.toString() ? `/api/qa?${params}` : '/api/qa';
      const data = await apiRequest<ListResponse>(path);
      return (data.entries || []).map(toQaEntry);
    },

    async getEntryById(id: string) {
      const data = await apiRequestOptional(`/api/qa/${encodeURIComponent(id)}`);
      if (!data) {
        return undefined;
      }
      return toQaEntry(data.entry);
    },

    async searchEntries(query: string) {
      const data = await apiRequest<ListResponse>(`/api/qa?search=${encodeURIComponent(query)}`);
      return (data.entries || []).map(toQaEntry);
    },
  };
}
