import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import globalErrorHandler from "./app/middleware/globalErrorHandler";
import { rootRouter } from "./app/routes";
// Initialize the Express application
const app: Application = express();

// ==========================================
// Global Middlewares
// ==========================================
// Enable Cross-Origin Resource Sharing
app.use(
  cors({
    origin: ["http://localhost:3053", "http://206.162.244.134:3053","http://2.25.95.233:3053","https://admin.sabledreams.com"],
    credentials: true,
  }),
);

// Parse cookies and populate req.cookies
app.use(cookieParser());

// Parse incoming JSON requests and put the parsed data in req.body
app.use(express.json());

// Parse incoming URL-encoded data
app.use(express.urlencoded({ extended: true }));

// ==========================================
// Application Routes
// ==========================================
// Health Check Endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "API is running smoothly!",
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Welcome to Sabledream API",
  });
});

// Mount modular routes here
app.use("/api/v1", rootRouter);

// ==========================================
// Error Handling
// ==========================================
// 404 Not Found Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handler
app.use(globalErrorHandler);

export default app;
