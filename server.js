const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const blogRoutes = require("./routes/blogs");
const authRoutes = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  "https://master-kenyan-sign-language-x4v8.vercel.app";

app.disable("x-powered-by");

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(cookieParser());

app.use(express.json({
  limit: "1mb",
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Too many login attempts. Please try again later.",
  },
});

app.use("/api/auth/login", loginLimiter);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.json({
    message: "Kenyan Sign Language backend is running!",
  });
});

app.use("/api/blogs", blogRoutes);
app.use("/api/auth", authRoutes);

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err.message);
  res.status(500).json({
    message: "Internal server error",
  });
});

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
  });
}

module.exports = app;
