function normaliseUrl(baseUrl) {
    try {
        return new URL(baseUrl);
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
    const rootUrl = normaliseUrl(apiUrl);
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
    };
}
