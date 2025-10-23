import { ManualProvider, ManualDownloadOptions } from './manualProvider.js';
import { ManualContent, UploadedFile } from '../types.js';

type ApiManual = Omit<UploadedFile, 'uploadedAt'> & { uploadedAt: string };

type ListResponse = {
  files: ApiManual[];
};

type DetailResponse = {
  file: ApiManual;
};

type DownloadUrlResponse = {
  downloadUrl: string;
};

type ContentResponse = {
  file: ApiManual;
  contentBase64: string;
};

export function resolveApiUrl(baseUrl: string): URL {
  const trimmed = baseUrl.trim();
  const hasProtocol = /^[a-zA-Z][\w+.-]*:/.test(trimmed);
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`;

  try {
    return new URL(candidate);
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
  const rootUrl = resolveApiUrl(apiUrl);

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

    async getManualDownloadUrl(id: string, options?: ManualDownloadOptions): Promise<string | undefined> {
      const expires = options?.expiresInSeconds;
      const query = typeof expires === 'number' ? `?expiresInSeconds=${expires}` : '';

      const response = await fetch(
        buildEndpoint(rootUrl, `/api/files/${encodeURIComponent(id)}/download-url${query}`),
        {
          headers: {
            Accept: 'application/json',
            Authorization: authHeader,
          },
        }
      );

      if (response.status === 404) {
        return undefined;
      }

      if (!response.ok) {
        throw new Error(
          `Manual API request failed (${response.status} ${response.statusText}) for /api/files/${id}/download-url`
        );
      }

      const data = (await response.json()) as DownloadUrlResponse;
      return data.downloadUrl;
    },

    async getManualContent(id: string): Promise<ManualContent | undefined> {
      const response = await fetch(
        buildEndpoint(rootUrl, `/api/files/${encodeURIComponent(id)}/content`),
        {
          headers: {
            Accept: 'application/json',
            Authorization: authHeader,
          },
        }
      );

      if (response.status === 404) {
        return undefined;
      }

      if (!response.ok) {
        throw new Error(
          `Manual API request failed (${response.status} ${response.statusText}) for /api/files/${id}/content`
        );
      }

      const data = (await response.json()) as ContentResponse;
      return {
        file: toUploadedFile(data.file),
        contentBase64: data.contentBase64,
      };
    },
  };
}
