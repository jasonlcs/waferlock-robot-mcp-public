"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQAApiProvider = void 0;
function toQaEntry(entry) {
    return {
        ...entry,
        createdAt: new Date(entry.createdAt),
        updatedAt: new Date(entry.updatedAt),
    };
}
function createQAApiProvider(apiUrl, apiToken) {
    const baseUrl = apiUrl.replace(/\/$/, '');
    if (!apiToken) {
        throw new Error('API token is required to initialise the QA API provider');
    }
    async function apiRequest(path, init) {
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
        return response.json();
    }
    async function apiRequestOptional(path) {
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
        return (await response.json());
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
            const data = await apiRequest(path);
            return (data.entries || []).map(toQaEntry);
        },
        async listQA(filter) {
            // Alias for listEntries
            return this.listEntries(filter);
        },
        async getEntryById(id) {
            const data = await apiRequestOptional(`/api/qa/${encodeURIComponent(id)}`);
            if (!data) {
                return undefined;
            }
            return toQaEntry(data.entry);
        },
        async getQAById(id) {
            // Alias for getEntryById
            return this.getEntryById(id);
        },
        async searchEntries(query) {
            const data = await apiRequest(`/api/qa?search=${encodeURIComponent(query)}`);
            return (data.entries || []).map(toQaEntry);
        },
    };
}
exports.createQAApiProvider = createQAApiProvider;
