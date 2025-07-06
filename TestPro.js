// 📦 COMBINED CBT SYSTEM + TOKEN PAYMENT SERVER
// ✅ CommonJS + Express + MongoDB + Paystack

const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const csv = require("csv-writer");
const XLSX = require("xlsx");
const axios = require("axios");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const MONGO_URI = process.env.MONGO_URI;

// ✅ Middleware
app.use(express.json());
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));
app.use(cors({ origin: '*', credentials: true }));

// ✅ Ensure upload directories exist
const uploadDir = path.join(__dirname, "uploads");
const scheduleDir = path.join(__dirname, "uploads/schedules");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
if (!fs.existsSync(scheduleDir)) fs.mkdirSync(scheduleDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

const scheduleUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, scheduleDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
  })
});

// ✅ Connect to MongoDB
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

// ✅ SCHEMAS
const studentSchema = new mongoose.Schema({
  name: String,
  matric: { type: String, unique: true },
  department: String,
  level: String,
  phone: String,
  email: { type: String, unique: true },
  password: String,
  passport: String,
});

const examSchema = new mongoose.Schema({
  course: String,
  courseCode: String,
  department: String,
  level: String,
  duration: Number,
  numQuestions: Number,
});

const questionSchema = new mongoose.Schema({
  courseCode: String,
  course: String,
  questionText: String,
  options: { a: String, b: String, c: String, d: String },
  correctAnswer: String,
});

const resultSchema = new mongoose.Schema({
  studentMatric: String,
  courseCode: String,
  score: Number,
  total: Number,
  timestamp: { type: Date, default: Date.now },
});

const allowedGroupSchema = new mongoose.Schema({
  department: String,
  level: String,
  status: { type: String, enum: ['allowed', 'blocked'], default: 'allowed' },
});

const scheduledSchema = new mongoose.Schema({
  name: String,
  department: String,
  level: String,
  matric: { type: String, unique: true },
});

const sessionSchema = new mongoose.Schema({
  sessionActive: { type: Boolean, default: false },
});

const transactionSchema = new mongoose.Schema({
  email: String,
  amount: Number,
  reference: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now },
});

const tokenSchema = new mongoose.Schema({
  studentName: String,
  studentEmail: String,
  amount: Number,
  reference: String,
  token: String,
  status: { type: String, enum: ['pending', 'success', 'used'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
});

// ✅ MODELS
const Student = mongoose.model("Student", studentSchema);
const Exam = mongoose.model("Exam", examSchema);
const Question = mongoose.model("Question", questionSchema);
const Result = mongoose.model("Result", resultSchema);
const AllowedGroup = mongoose.model("AllowedGroup", allowedGroupSchema);
const ScheduledStudent = mongoose.model("ScheduledStudent", scheduledSchema);
const SessionControl = mongoose.model("SessionControl", sessionSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);
const Token = mongoose.model("Token", tokenSchema);

// ✅ Sample GET Route
app.get("/", (req, res) => {
  res.send("✅ CBT & Token Server is running");
});

// ✍️ From here, you can start adding all your existing routes one by one below.
// Make sure they are using these same models (already declared above)
// You don’t need to connect to Mongo again — it’s connected once globally.
// You don’t need a second server — all APIs can go here.

// 💡 Suggestion: You can move all route definitions into a folder like /routes and import here for cleanliness.

// ✅ Start server
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
