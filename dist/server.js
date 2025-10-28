"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIO = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables FIRST before any other imports
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const http_1 = require("http");
const tokens_1 = __importDefault(require("./routes/tokens"));
const files_1 = __importDefault(require("./routes/files"));
const qa_1 = __importDefault(require("./routes/qa"));
const search_1 = __importDefault(require("./routes/search"));
const vectorIndex_1 = __importDefault(require("./routes/vectorIndex"));
const webhooks_1 = __importDefault(require("./routes/webhooks"));
const indexingCallback_1 = __importDefault(require("./routes/indexingCallback"));
const cases_1 = __importDefault(require("./routes/cases"));
const recommendations_1 = __importDefault(require("./routes/recommendations"));
const statistics_1 = __importDefault(require("./routes/statistics"));
const socketManager_1 = require("./utils/socketManager");
const app = express_1.default();
const PORT = process.env.PORT || 3000;
// Middleware
app.use(cors_1.default());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Static files
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
// API Routes
app.use('/api/tokens', tokens_1.default);
app.use('/api/files', files_1.default);
app.use('/api/qa', qa_1.default);
app.use('/api/search', search_1.default);
app.use('/api/vector-index', vectorIndex_1.default);
app.use('/api/webhooks', webhooks_1.default);
app.use('/api/cases', cases_1.default);
app.use('/api/recommendations', recommendations_1.default);
app.use('/api/statistics', statistics_1.default);
app.use('/api', indexingCallback_1.default);
// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Waferlock Robot MCP Server is running' });
});
// Serve index.html for root
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/index.html'));
});
// Create HTTP server
const httpServer = http_1.createServer(app);
// Initialize Socket.IO
socketManager_1.socketManager.initialize(httpServer);
// Export Socket.IO instance for use in routes
const getIO = () => socketManager_1.socketManager.getIO();
exports.getIO = getIO;
// Start server
httpServer.listen(PORT, () => {
    console.log(`🚀 Waferlock Robot MCP Web Server running on port ${PORT}`);
    console.log(`📱 Open http://localhost:${PORT} to access the web interface`);
    console.log(`🔌 WebSocket server ready for real-time updates`);
});
exports.default = app;
