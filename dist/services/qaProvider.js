"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createS3QAProvider = void 0;
const qaService_1 = require("./qaService");
function createS3QAProvider() {
    return {
        listEntries: (filter) => qaService_1.qaService.listEntries(filter),
        listQA: (filter) => qaService_1.qaService.listEntries(filter),
        getEntryById: (id) => qaService_1.qaService.getEntryById(id),
        getQAById: (id) => qaService_1.qaService.getEntryById(id),
        searchEntries: (query) => qaService_1.qaService.searchEntries(query),
    };
}
exports.createS3QAProvider = createS3QAProvider;
