"use strict";
/**
 * 向量索引系統型別定義
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VectorIndexStage = exports.VectorIndexStatus = void 0;
var VectorIndexStatus;
(function (VectorIndexStatus) {
    VectorIndexStatus["PENDING"] = "pending";
    VectorIndexStatus["INITIALIZING"] = "initializing";
    VectorIndexStatus["EXTRACTING"] = "extracting";
    VectorIndexStatus["EMBEDDING"] = "embedding";
    VectorIndexStatus["INDEXING"] = "indexing";
    VectorIndexStatus["SAVING"] = "saving";
    VectorIndexStatus["UPLOADING"] = "uploading";
    VectorIndexStatus["COMPLETED"] = "completed";
    VectorIndexStatus["FAILED"] = "failed";
    VectorIndexStatus["CANCELLED"] = "cancelled";
})(VectorIndexStatus = exports.VectorIndexStatus || (exports.VectorIndexStatus = {}));
var VectorIndexStage;
(function (VectorIndexStage) {
    VectorIndexStage["INITIALIZATION"] = "initialization";
    VectorIndexStage["TEXT_EXTRACTION"] = "text_extraction";
    VectorIndexStage["EMBEDDING_GENERATION"] = "embedding_generation";
    VectorIndexStage["INDEX_BUILDING"] = "index_building";
    VectorIndexStage["METADATA_STORAGE"] = "metadata_storage";
    VectorIndexStage["S3_UPLOAD"] = "s3_upload";
    VectorIndexStage["COMPLETED"] = "completed";
})(VectorIndexStage = exports.VectorIndexStage || (exports.VectorIndexStage = {}));
