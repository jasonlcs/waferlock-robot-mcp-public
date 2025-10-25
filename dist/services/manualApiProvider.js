export function resolveApiUrl(baseUrl) {
    const trimmed = baseUrl.trim();
    const hasProtocol = /^[a-zA-Z][\w+.-]*:/.test(trimmed);
    const candidate = hasProtocol ? trimmed : `https://${trimmed}`;
    try {
        return new URL(candidate);
    }
    catch {
        throw new Error(`Invalid API URL provided: ${baseUrl}`);
    }
}
function buildEndpoint(root, path) {
    const next = new URL(path.replace(/^\//, ''), root);
    return next.toString();
}
function toUploadedFile(manual) {
    return {
        ...manual,
        uploadedAt: manual.uploadedAt ? new Date(manual.uploadedAt) : new Date(),
    };
}
export function createManualApiProvider(apiUrl, apiToken) {
    const rootUrl = resolveApiUrl(apiUrl);
    if (!apiToken) {
        throw new Error('API token is required to initialise the manual API provider');
    }
    const authHeader = `Bearer ${apiToken}`;
    async function request(path) {
        const response = await fetch(buildEndpoint(rootUrl, path), {
            headers: {
                Accept: 'application/json',
                Authorization: authHeader,
            },
        });
        if (!response.ok) {
            throw new Error(`Manual API request failed (${response.status} ${response.statusText}) for ${path}`);
        }
        return response.json();
    }
    async function requestOptional(path) {
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
            throw new Error(`Manual API request failed (${response.status} ${response.statusText}) for ${path}`);
        }
        return (await response.json());
    }
    return {
        async listManuals() {
            const data = await request('/api/files/list');
            return (data.files || []).map(toUploadedFile);
        },
        async getManualById(id) {
            const data = await requestOptional(`/api/files/${encodeURIComponent(id)}`);
            if (!data) {
                return undefined;
            }
            return toUploadedFile(data.file);
        },
        async getManualDownloadUrl(id, options) {
            const expires = options?.expiresInSeconds;
            const query = typeof expires === 'number' ? `?expiresInSeconds=${expires}` : '';
            const response = await fetch(buildEndpoint(rootUrl, `/api/files/${encodeURIComponent(id)}/download-url${query}`), {
                headers: {
                    Accept: 'application/json',
                    Authorization: authHeader,
                },
            });
            if (response.status === 404) {
                return undefined;
            }
            if (!response.ok) {
                throw new Error(`Manual API request failed (${response.status} ${response.statusText}) for /api/files/${id}/download-url`);
            }
            const data = (await response.json());
            return data.downloadUrl;
        },
        async getManualContent(id) {
            const response = await fetch(buildEndpoint(rootUrl, `/api/files/${encodeURIComponent(id)}/content`), {
                headers: {
                    Accept: 'application/json',
                    Authorization: authHeader,
                },
            });
            if (response.status === 404) {
                return undefined;
            }
            if (!response.ok) {
                throw new Error(`Manual API request failed (${response.status} ${response.statusText}) for /api/files/${id}/content`);
            }
            const data = (await response.json());
            return {
                file: toUploadedFile(data.file),
                contentBase64: data.contentBase64,
            };
        },
        async searchManualVector(fileId, query, k = 5, minScore = 0.0) {
            const response = await fetch(buildEndpoint(rootUrl, '/api/vector-index/search'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Authorization: authHeader,
                },
                body: JSON.stringify({
                    fileId,
                    query,
                    k,
                    minScore,
                }),
            });
            if (!response.ok) {
                throw new Error(`Vector search API request failed (${response.status} ${response.statusText})`);
            }
            const data = await response.json();
            return data.results || [];
        },
    };
}
