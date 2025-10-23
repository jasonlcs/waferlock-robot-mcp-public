import { ManualProvider } from './manualProvider.js';
import { UploadedFile } from '../types.js';

type ApiManual = Omit<UploadedFile, 'uploadedAt'> & { uploadedAt: string };

type ListResponse = {
  files: ApiManual[];
};

type DetailResponse = {
  file: ApiManual;
};

function normaliseUrl(baseUrl: string): URL {
  try {
    return new URL(baseUrl);
  } catch {
    throw new Error(`Invalid API URL provided: ${baseUrl}`);
  }
}

function buildEndpoint(root: URL, path: string): string {
  const next = new URL(path.replace(/^\//, ''), root);
  return next.toString();
}

function toUploadedFile(manual: ApiManual): UploadedFile {
  return {
    ...manual,
    uploadedAt: manual.uploadedAt ? new Date(manual.uploadedAt) : new Date(),
  };
}

export function createManualApiProvider(apiUrl: string, apiToken: string): ManualProvider {
  const rootUrl = normaliseUrl(apiUrl);

  if (!apiToken) {
    throw new Error('API token is required to initialise the manual API provider');
  }

  const authHeader = `Bearer ${apiToken}`;

  async function request<T>(path: string): Promise<T> {
    const response = await fetch(buildEndpoint(rootUrl, path), {
      headers: {
        Accept: 'application/json',
        Authorization: authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Manual API request failed (${response.status} ${response.statusText}) for ${path}`
      );
    }

    return response.json() as Promise<T>;
  }

  async function requestOptional(path: string): Promise<DetailResponse | undefined> {
    const response = await fetch(buildEndpoint(rootUrl, path), {
      headers: {
        Accept: 'application/json',
        Authorization: authHeader,
      },
    });

    if (response.status === 404) {
      return undefined;
    }

    if (!response.ok) {
      throw new Error(
        `Manual API request failed (${response.status} ${response.statusText}) for ${path}`
      );
    }

    return (await response.json()) as DetailResponse;
  }

  return {
    async listManuals(): Promise<UploadedFile[]> {
      const data = await request<ListResponse>('/api/files/list');
      return (data.files || []).map(toUploadedFile);
    },

    async getManualById(id: string): Promise<UploadedFile | undefined> {
      const data = await requestOptional(`/api/files/${encodeURIComponent(id)}`);
      if (!data) {
        return undefined;
      }
      return toUploadedFile(data.file);
    },
  };
}
