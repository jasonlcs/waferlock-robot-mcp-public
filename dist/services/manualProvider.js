"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createS3ManualProvider = void 0;
const s3Service_1 = require("./s3Service");
function createS3ManualProvider() {
    return {
        listManuals: () => s3Service_1.s3Service.listFiles(),
        getManualById: (id) => s3Service_1.s3Service.getFileById(id),
        getManualDownloadUrl: (id, options) => s3Service_1.s3Service.generateDownloadUrl(id, options),
        getManualContent: async (id) => {
            const result = await s3Service_1.s3Service.downloadFileBuffer(id);
            if (!result) {
                return undefined;
            }
            return {
                file: result.file,
                contentBase64: result.buffer.toString('base64'),
            };
        },
    };
}
exports.createS3ManualProvider = createS3ManualProvider;
