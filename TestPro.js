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
const { Parser } = require('json2csv');
const submissionQueue = [];
let activeSubmissions = 0;

const app = express();
const PORT = process.env.PORT || 5000;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const MONGO_URI = process.env.MONGO_URI;
const MAX_CONCURRENT_SUBMISSIONS = 25;


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

const submissionSchema = new mongoose.Schema({
  matric: { type: String, required: true },
  name: { type: String, required: true },
  department: { type: String, required: true },
  courseCode: { type: String, required: true },
  answers: { type: Object, required: true },
  submittedAt: { type: Date, default: Date.now }
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
  caScore: Number,        
  totalScore: Number,     
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
  source: { type: String, enum: ['payment', 'manual'], default: 'manual' }, // ✅ NEW
  createdAt: { type: Date, default: Date.now },
});

const adminSchema = new mongoose.Schema({
  username: String,
  password: String,
});

const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed
});

const publicUserSchema = new mongoose.Schema({
  name: String,
  phone: { type: String, unique: true },
  email: { type: String, unique: true },
  password: String,
  passport: String,
  registeredAt: { type: Date, default: Date.now }
});


// ✅ MODELS
const Student = mongoose.model("Student", studentSchema);
const Exam = mongoose.model("Exam", examSchema);
const Question = mongoose.model("Question", questionSchema);
const Submission = mongoose.model("Submission", submissionSchema);
const Result = mongoose.model("Result", resultSchema);
const AllowedGroup = mongoose.model("AllowedGroup", allowedGroupSchema);
const ScheduledStudent = mongoose.model("ScheduledStudent", scheduledSchema);
const SessionControl = mongoose.model("SessionControl", sessionSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);
const Token = mongoose.model("Token", tokenSchema);
const studentSessions = new Set();
const Admin = mongoose.model("Admin", adminSchema);
const Settings = mongoose.model("Settings", settingsSchema);
const PublicUser = mongoose.model("PublicUser", publicUserSchema);
// Routes

// Department mapping
function getDepartmentAndLevelFromMatric(matric) {
  if (matric.startsWith("HND/")) {
    // HND student format: HND/23/01/001
    const parts = matric.split("/");
    const deptCode = parts[2]; // e.g., "01"

    const hndMap = {
      "01": "Accountancy",
      "02": "Biochemistry",
      "03": "Business Administration",
      "04": "Computer Engineering",
      "05": "Computer Science",
      "06": "Electrical Engineering",
      "07": "Mass Communication",
      "08": "Microbiology"
    };

    return {
      department: hndMap[deptCode] || "Unknown",
      level: "HND"
    };

  } else {
    // ND student format: e.g., Cos/023456
    const prefix = matric.split("/")[0];
    const ndMap = {
      "S": "Science Laboratory Technology",
      "COS": "Computer Science",
      "COE": "Computer Engineering",
      "B": "Business Administration",
      "EST": "Estate Management",
      "E": "Electrical Engineering",
      "M": "Mass Communication",
      "A": "Accountancy",
      "MLT": "Medical Laboratory Technology"
    };

    return {
      department: ndMap[prefix] || "Unknown",
      level: "ND"
    };
  }
      }

  // Student Registration
app.post("/api/students/register", upload.single("passport"), async (req, res) => {
  try {
    let { name, matric, phone, email, password, confirmPassword, token, level } = req.body;
    const passport = req.file ? req.file.filename : null;

    // Convert matric to uppercase
    matric = matric.toUpperCase();

    // ✅ Validate all required fields
    if (!name || !matric || !phone || !email || !password || !confirmPassword || !passport || !token || !level) {
      return res.status(400).json({ message: "All fields and token are required." });
    }

    // ✅ Confirm password match
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match." });
    }

    // ✅ Check if token is valid and unused
    const validToken = await Token.findOne({ token, status: "success" });
    if (!validToken) {
      return res.status(400).json({ message: "Invalid or already used token." });
    }

    // ✅ Check for duplicates (matric or email)
    const existingStudent = await Student.findOne({ $or: [{ matric }, { email }] });
    if (existingStudent) {
      return res.status(409).json({
        message: existingStudent.matric === matric
          ? "A student with this matric number already exists."
          : "A student with this email already exists."
      });
    }

    // ✅ Detect department from matric prefix
    const { department } = getDepartmentAndLevelFromMatric(matric);

    // ✅ Save new student with plain text password
    const newStudent = new Student({
      name,
      matric,
      department,
      level,
      phone,
      email,
      password, 
      passport
    });

    await newStudent.save();

    // ✅ Mark token as used
    validToken.status = "used";
    await validToken.save();

    res.status(201).json({ message: "Student registered successfully." });

  } catch (err) {
    console.error("🚨 Registration error:", err.message);
    if (err.code === 11000) {
      return res.status(409).json({ message: "Email or Matric already exists." });
    }
    res.status(500).json({ message: "An error occurred. Please try again." });
  }
});

// Register Student via JSON for Load Testing (no passport upload)
app.post("/api/students/register-json", async (req, res) => {
  try {
    let { name, matric, phone, email, password, token, level } = req.body;

    // Convert matric to uppercase
    matric = matric.toUpperCase();

    // Basic validation
    if (!name || !matric || !phone || !email || !password || !token || !level) {
      return res.status(400).json({ message: "All fields and token are required." });
    }

    // ✅ Token validation (real, one-time use)
    const validToken = await Token.findOne({ token, status: "success" });
    if (!validToken) {
      return res.status(400).json({ message: "Invalid or already used token." });
    }

    // ✅ Prevent duplicates
    const existingStudent = await Student.findOne({ $or: [{ matric }, { email }] });
    if (existingStudent) {
      return res.status(409).json({
        message: existingStudent.matric === matric
          ? "A student with this matric number already exists."
          : "A student with this email already exists."
      });
    }

    // ✅ Department detection
    const { department } = getDepartmentAndLevelFromMatric(matric);

    // ✅ Save dummy passport for testing
    const newStudent = new Student({
      name,
      matric,
      department,
      level,
      phone,
      email,
      password,
      passport: "k6_dummy.jpg"
    });

    await newStudent.save();

    // ✅ Mark token as used
    validToken.status = "used";
    await validToken.save();

    res.status(201).json({ message: "Student registered successfully (JSON)." });

  } catch (err) {
    console.error("🔥 Registration error:", err.message);
    if (err.code === 11000) {
      return res.status(409).json({ message: "Email or Matric already exists." });
    }
    res.status(500).json({ message: err.message || "Server error" });
  }
});

// Student Login
app.post("/api/students/login", async (req, res) => {
  let { matric, password } = req.body;

  // ✅ Convert to uppercase to handle case-insensitive matching
  matric = matric.toUpperCase();

  // 1. ✅ Check session status
  const session = await SessionControl.findOne();
  if (!session || !session.sessionActive) {
    return res.status(403).json({ message: "Exam session is not active. Please contact your admin." });
  }

  // 2. ✅ Check student credentials
  const student = await Student.findOne({ matric, password });
  if (!student) {
    return res.status(401).json({ message: "Invalid matric number or password." });
  }

  // 3. ✅ Check if department/level is allowed
  const isAllowed = await AllowedGroup.findOne({
    department: student.department,
    level: student.level,
    status: 'allowed'
  });

  if (!isAllowed) {
    return res.status(403).json({ message: "Your department and level is currently restricted from accessing the exam." });
  }

  // 4. ✅ Check if student is scheduled
  const isScheduled = await ScheduledStudent.findOne({ matric: student.matric });

  if (!isScheduled) {
    return res.status(403).json({ message: "You are not scheduled for this exam." });
  }

  // 5. ✅ Passed all checks — allow login
  studentSessions.add(matric);
  res.json({ message: "Login successful", student });
});

// TEST Login route for load testing (no hashing)
app.post("/api/students/test-login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required." });
    }

    // Only match from test accounts (optional)
    const student = await Student.findOne({ email });

    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    if (student.password !== password) {
      return res.status(401).json({ message: "Incorrect password." });
    }

    res.status(200).json({ message: "Login successful", student });

  } catch (err) {
    console.error("Test login error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});

// Start or Stop Exam Session (POST)
app.post("/api/schedule/session", async (req, res) => {
  const { active } = req.body;

  try {
    let session = await SessionControl.findOne();
    if (!session) session = new SessionControl();
    session.sessionActive = !!active;
    await session.save();

    res.json({ message: `Session is now ${active ? "ACTIVE" : "INACTIVE"}` });
  } catch (err) {
    console.error("Session Toggle Error:", err);
    res.status(500).json({ message: "Failed to update session status" });
  }
});

//  Check Session Status (GET)
app.get("/api/schedule/session/status", async (req, res) => {
  try {
    const session = await SessionControl.findOne();
    res.json({ active: session?.sessionActive || false });
  } catch (err) {
    console.error("Session Status Error:", err);
    res.status(500).json({ message: "Could not fetch session status" });
  }
});

//  Check if Student is Allowed to Take Exam (POST)
app.post("/api/schedule/check", async (req, res) => {
  const { matric } = req.body;

  try {
    const session = await SessionControl.findOne();
    const student = await ScheduledStudent.findOne({ matric });

    if (!session || !session.sessionActive) {
      return res.status(403).json({ message: "Exam session is not active" });
    }

    if (!student) {
      return res.status(403).json({ message: "You are not scheduled for this exam" });
    }

    res.json({ message: "You are cleared to proceed", student });
  } catch (err) {
    console.error("Schedule Check Error:", err);
    res.status(500).json({ message: "Failed to verify student" });
  }
});

  // Student Dashboard
  app.get("/api/students/dashboard", async (req, res) => {
    try {
      const students = await Student.find().select("-password");
      const formatted = students.map((s) => ({
        ...s._doc,
        passport: s.passport ? `${req.protocol}://${req.get("host")}/uploads/${s.passport}` : null
      }));

      res.json({
        students: formatted,
        sessions: Array.from(studentSessions),
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to load dashboard" });
    }
  });

// Download Students List 

app.get("/api/students/download", async (req, res) => {
  try {
    const students = await Student.find().lean();

    if (!students.length) {
      return res.status(404).send("No students found.");
    }

    const fields = [
      { label: "Name", value: "name" },
      { label: "Matric Number", value: "matric" },
      { label: "Department", value: "department" },
      { label: "Email", value: "email" },
      { label: "Phone", value: "phone" },
      { label: "Level", value: "level" }
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(students);

    res.header("Content-Type", "text/csv");
    res.attachment("students.csv");
    res.send(csv);
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).send("Failed to download student list.");
  }
});
  // Create Exam
  app.post("/api/exams", async (req, res) => {
    const { course, courseCode, department, level, duration, numQuestions } = req.body;

    if (!course || !courseCode || !department || !level || !duration || !numQuestions) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const existing = await Exam.findOne({ courseCode });
    if (existing) {
      return res.status(409).json({ message: "Exam already exists for this course code." });
    }

    const exam = new Exam({ course, courseCode, department, level, duration, numQuestions });
    await exam.save();

    res.json({ message: "Exam created", exam });
  });

  // Save Questions
  app.post("/api/exams/:courseCode/questions", async (req, res) => {
    const { courseCode } = req.params;
    const { questions } = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: "No questions provided." });
    }

    const courseTitle = questions[0]?.course || "Untitled Course";

    const formatted = questions.map(q => ({
      courseCode,
      course: q.course || courseTitle,
      questionText: q.questionText,
      options: q.options,
      correctAnswer: q.correctAnswer
    }));

    await Question.insertMany(formatted);

    let exam = await Exam.findOne({ courseCode });
    if (!exam) {
      const newExam = new Exam({
        course: courseTitle,
        courseCode,
        numQuestions: formatted.length
      });
      await newExam.save();
    }

    res.json({ message: "Questions saved successfully" });
  });

// Filtered Exam List
app.get("/api/exams", async (req, res) => {
  const { department, level } = req.query;

  try {
    let filter = {};

    if (department === "public" || level === "public") {
      filter = { department: "public", level: "public" }; // Explicitly fetch public exams
    } else {
      if (department) filter.department = department;
      if (level) filter.level = level;
    }

    const exams = await Exam.find(filter);
    res.json(exams);

  } catch (err) {
    res.status(500).json({ message: "Unable to fetch exam list." });
  }
});
// Get Course List for Frontend
app.get("/api/questions/courses", async (req, res) => {
  try {
    // Retrieve courses including department and level
    const exams = await Exam.find({}, "course courseCode department level");
    
    const courses = exams.map((exam) => ({
      title: exam.course,
      code: exam.courseCode,
      department: exam.department,
      level: exam.level
    }));

    res.json({ courses });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch courses." });
  }
});

  // Load Questions for a Course
  
app.get("/api/exams/:courseCode/questions", async (req, res) => {
  const rawCode = req.params.courseCode;
  try {
    const courseCode = decodeURIComponent(rawCode).trim().toLowerCase();

    const questions = await Question.find({
      courseCode: { $regex: new RegExp(`^${courseCode}$`, "i") } // case-insensitive
    });

    res.json({ courseCode, questions });
  } catch (err) {
    console.error("Error fetching questions:", err);
    res.status(500).json({ message: "Failed to load questions." });
  }
});
// Load exam info  and duration
app.get("/api/exams/:courseCode", async (req, res) => {
  const { courseCode } = req.params;
  try {
    const exam = await Exam.findOne({ courseCode });
    if (!exam) return res.status(404).json({ message: "Exam not found" });
    res.json({ exam });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch exam settings" });
  }
});

  
// ✅ Process submission queue
async function processNextSubmission() {
  if (submissionQueue.length === 0 || activeSubmissions >= MAX_CONCURRENT_SUBMISSIONS) return;

  const { req, res } = submissionQueue.shift();
  activeSubmissions++;

  try {
    const { matric, name, department, courseCode, answers } = req.body;

    if (!matric || !courseCode || typeof answers !== "object") {
      return res.status(400).json({ message: "Missing or invalid submission data." });
    }

    // ✅ Check if already submitted
    const existing = await Submission.findOne({ matric, courseCode });
    if (existing) {
      return res.status(409).json({ message: "Submission already exists." });
    }

    // ✅ Save raw submission
    await Submission.create({ matric, name, department, courseCode, answers, submittedAt: new Date() });

    // ✅ Get questions and score
    const questions = await Question.find({ courseCode });
    let score = 0;
    questions.forEach(q => {
      if (answers[q._id] && answers[q._id] === q.correctAnswer) {
        score++;
      }
    });

    // ✅ Generate random CA score between 20 and 35
    const caScore = Math.floor(Math.random() * (35 - 20 + 1)) + 20;
    const totalScore = score + caScore;

    // ✅ Save to Result model
    const resultExists = await Result.findOne({ studentMatric: matric, courseCode });
    if (!resultExists) {
      await Result.create({
        studentMatric: matric,
        courseCode,
        score,
        total: questions.length,
        caScore,
        totalScore
      });
    }

    res.status(200).json({ message: "Exam submitted successfully" });

  } catch (err) {
    console.error("Submission error:", err);
    res.status(500).json({ message: "Submission failed" });
  } finally {
    activeSubmissions--;
    processNextSubmission(); // process next in queue
  }
}

// ✅ Submit exam route
app.post("/api/exams/:courseCode/submit", (req, res) => {
  submissionQueue.push({ req, res });
  processNextSubmission();
});

// ✅ Save access for a department + level (allow or block)
app.post("/api/admin/access-control", async (req, res) => {
  const { department, level, status } = req.body;

  if (!department || !level || !status) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    const existing = await AllowedGroup.findOne({ department, level });

    if (existing) {
      existing.status = status;
      await existing.save();
    } else {
      await AllowedGroup.create({ department, level, status });
    }

    res.json({ message: `Access for ${department} ${level} set to ${status}.` });
  } catch (err) {
    console.error("Access control error:", err);
    res.status(500).json({ message: "Error saving access rule." });
  }
});

// ✅ Get all access rules
app.get("/api/admin/access-groups", async (req, res) => {
  try {
    const rules = await AllowedGroup.find();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ message: "Failed to load access groups." });
  }
});

// ✅ Toggle global access control ON/OFF
app.post("/api/admin/access-control-toggle", async (req, res) => {
  const { enabled } = req.body;

  if (typeof enabled !== "boolean") {
    return res.status(400).json({ message: "Invalid value for 'enabled'" });
  }

  try {
    await Settings.findOneAndUpdate(
      { key: "globalAccessControl" },
      { value: enabled },
      { upsert: true, new: true }
    );

    res.json({ message: `Global access control set to ${enabled ? "ON" : "OFF"}` });
  } catch (err) {
    console.error("Toggle error:", err);
    res.status(500).json({ message: "Failed to update access control status." });
  }
});

// ✅ Get current global access control status
app.get("/api/admin/access-control-toggle", async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: "globalAccessControl" });
    res.json({ enabled: setting ? setting.value : true }); // Default: enabled
  } catch (err) {
    console.error("Fetch toggle error:", err);
    res.status(500).json({ message: "Failed to retrieve toggle state." });
  }
});

// ✅ Upload Scheduled Students via Excel
app.post("/api/schedule/upload", cors(), scheduleUpload.single("file"), async (req, res) => {
  try {
    const ext = path.extname(req.file.originalname);
    if (![".xlsx", ".xls"].includes(ext)) {
      return res.status(400).json({ message: "Invalid file type. Please upload an Excel file." });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const bulkOps = data.map((row) => ({
      updateOne: {
        filter: { matric: row.matric },
        update: {
          name: row.name,
          department: row.department,
          level: row.level,
          matric: row.matric
        },
        upsert: true
      }
    }));

    await ScheduledStudent.bulkWrite(bulkOps); 

    res.json({ message: "Scheduled students uploaded successfully" });

  } catch (err) {
    console.error("Excel Upload Error:", err.stack || err);
    res.status(500).json({ message: "Failed to upload students" });
  }
});

// Get list of scheduled students
app.get("/api/schedule/list", async (req, res) => {
  try {
    const ScheduledStudent = mongoose.model("ScheduledStudent");
    const students = await ScheduledStudent.find();
    res.json(students);
  } catch (err) {
    console.error("Failed to fetch scheduled list:", err);
    res.status(500).json({ message: "Error fetching schedule list" });
  }
});

// Clear all scheduled students
app.delete("/api/schedule/clear", async (req, res) => {
  try {
    const ScheduledStudent = mongoose.model("ScheduledStudent");
    await ScheduledStudent.deleteMany({});
    res.json({ message: "Scheduled list cleared successfully." });
  } catch (err) {
    console.error("Error clearing scheduled list:", err);
    res.status(500).json({ message: "Error clearing schedule list" });
  }
});

  // ✅ Get JSON results with full score details
app.get("/api/results", async (req, res) => {
  try {
    const results = await Result.find();
    const students = await Student.find();

    const enriched = results.map(result => {
      const student = students.find(s => s.matric === result.studentMatric);
      return {
        name: student?.name || "Unknown",
        matric: result.studentMatric,
        department: student?.department || "Unknown",
        courseCode: result.courseCode,
        caScore: result.caScore || 0,
        score: result.score,
        totalScore: result.totalScore || (result.score || 0),
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("Failed to fetch results:", err);
    res.status(500).json({ error: "Failed to fetch results" });
  }
});

// ✅ Download results with CA, Exam, and Total
app.get("/api/results/download", async (req, res) => {
  try {
    const submissions = await Result.find();
    const students = await Student.find();

    const records = submissions.map(sub => {
      const student = students.find(s => s.matric === sub.studentMatric);
      return {
        Name: student?.name || "",
        Matric: sub.studentMatric,
        Department: student?.department || "",
        CourseCode: sub.courseCode,
        CAScore: sub.caScore || 0,
        ExamScore: sub.score || 0,
        TotalScore: sub.totalScore || (sub.score || 0),
      };
    });

    const filePath = path.join(__dirname, "results.csv");
    const writer = csv.createObjectCsvWriter({
      path: filePath,
      header: [
        { id: "Name", title: "Name" },
        { id: "Matric", title: "Matric" },
        { id: "Department", title: "Department" },
        { id: "CourseCode", title: "Course Code" },
        { id: "CAScore", title: "CA Score" },
        { id: "ExamScore", title: "Exam Score" },
        { id: "TotalScore", title: "Total Score" },
      ],
    });

    await writer.writeRecords(records);

    res.download(filePath, "results.csv", (err) => {
      if (!err) fs.unlinkSync(filePath);
    });
  } catch (error) {
    console.error("CSV download error:", error);
    res.status(500).json({ error: "Failed to generate result CSV" });
  }
});

// Admin Registration Route
app.post('/api/admin/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const newAdmin = new Admin({ username, password });
    await newAdmin.save();

    res.status(201).json({ message: 'Admin registered successfully' });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admin Login Route
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const admin = await Admin.findOne({ username });
    if (!admin || admin.password !== password) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    res.json({
      message: 'Login successful',
      admin: { id: admin._id, username: admin.username }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// ✅ Route to create a reusable Paystack split code
app.post('/api/split/create', async (req, res) => {
  try {
    const response = await axios.post(
      'https://api.paystack.co/split',
      {
        name: 'CBT Token Split Group',
        type: 'percentage',
        currency: 'NGN',
        subaccounts: [
          {
            subaccount: 'ACCT_370jqx88t6rgcz4',
            share: 70
          }
        ],
        bearer_type: 'subaccount', // ✅ Subaccount bears the transaction fee
        bearer_subaccount: 'ACCT_370jqx88t6rgcz4'
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      message: '✅ Split group created successfully',
      split_code: response.data.data.split_code,
      full_data: response.data.data
    });
  } catch (error) {
    console.error("❌ Split creation error:", error.response?.data || error.message);
    return res.status(500).json({
      error: 'Failed to create split group',
      details: error.response?.data || error.message
    });
  }
});


// ✅ Initialize payment for Paystack popup (NO callback_url)
app.post('/api/payment/initialize', async (req, res) => {
  const { email, amount } = req.body;

  try {
    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email,
      amount: amount * 100,
      split_code: 'SPL_wRVJKCtJsj'
    }, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const { authorization_url, reference } = response.data.data;

    await Transaction.create({ email, amount, reference });
    res.json({ authorization_url, reference });
  } catch (error) {
    console.error("Init error:", error.response?.data || error.message);
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

// ✅ Verify payment and generate token
app.get('/api/payment/verify/:reference', async (req, res) => {
  const { reference } = req.params;

  try {
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });

    const status = response.data.data.status;

    const transaction = await Transaction.findOneAndUpdate(
      { reference },
      { status },
      { new: true }
    );

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (status === 'success') {
      const existingToken = await Token.findOne({ reference });
      if (existingToken) {
        return res.json({
          message: 'Payment already verified, token exists',
          token: existingToken.token,
          transaction,
        });
      }

      const tokenCode = 'CBT-' + Math.floor(100000 + Math.random() * 900000);

      const newToken = new Token({
        token: tokenCode,
        studentEmail: transaction.email,
        amount: transaction.amount,
        reference,
        status: 'success',
        createdAt: new Date()
      });

      await newToken.save();

      return res.json({
        message: 'Payment verified and token issued',
        token: tokenCode,
        transaction,
      });
    } else {
      return res.status(400).json({ message: 'Payment not successful', status });
    }
  } catch (error) {
    console.error("Verify error:", error.message);
    return res.status(500).json({ error: 'Payment verification failed' });
  }
});

// Validate Email Before Auto-Generating
app.post('/api/tokens/check-email', async (req, res) => {
  const { email } = req.body;

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ allowed: false, message: "Invalid email format" });
  }

  const existingTokens = await Token.find({ studentEmail: email, source: 'manual' });

  if (existingTokens.length >= 2) {
    return res.status(403).json({ allowed: false, message: "This email has reached the maximum token limit." });
  }

  res.json({ allowed: true });
});

// ✅ Save transaction manually
app.post('/api/transactions/save', async (req, res) => {
  const { email, amount, reference } = req.body;

  try {
    const existing = await Transaction.findOne({ reference });
    if (!existing) {
      await Transaction.create({ email, amount, reference });
    }
    res.json({ message: 'Transaction saved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to save transaction' });
  }
});


// ✅ Generate token manually without payment
app.post('/api/tokens/generate/manual', async (req, res) => {
  const { email } = req.body;

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ message: "Invalid email" });
  }

  const count = await Token.countDocuments({ studentEmail: email, source: 'manual' });

  if (count >= 2) {
    return res.status(403).json({ message: "This email has already generated 2 tokens." });
  }

  const tokenCode = 'CBT-' + Math.floor(100000 + Math.random() * 900000);

  const newToken = new Token({
    studentEmail: email,
    token: tokenCode,
    source: 'manual',
    status: 'success',
    createdAt: new Date()
  });

  await newToken.save();

  res.json({ token: tokenCode });
});

// ✅ Get all tokens
app.get('/api/tokens', async (req, res) => {
  try {
    const tokens = await Token.find().sort({ createdAt: -1 });
    res.json(tokens);
  } catch (err) {
    res.status(500).json({ message: "Error fetching tokens" });
  }
});

// ✅ Validate token route
app.get('/api/tokens/validate/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const found = await Token.findOne({ token });

    if (!found) {
      return res.status(404).json({ valid: false, message: "Token not found." });
    }

    if (found.status !== 'success') {
      return res.status(400).json({ valid: false, message: "Token is not valid or already used." });
    }

    return res.json({ valid: true });
  } catch (err) {
    console.error("Token validation error:", err.message);
    res.status(500).json({ valid: false, message: "Server error." });
  }
});


// =======================
// Public Registration Route
// =======================
app.post("/api/public/register", upload.single("passport"), async (req, res) => {
  try {
    const { name, phone, email, password, confirmPassword, token } = req.body;
    const passport = req.file ? req.file.filename : null;

    // ✅ Validate all required fields
    if (!name || !phone || !email || !password || !confirmPassword || !passport || !token) {
      return res.status(400).json({ message: "All fields and token are required." });
    }

    // ✅ Confirm password match
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match." });
    }

    // ✅ Check if token is valid and unused
    const validToken = await Token.findOne({ token, status: "success" });
    if (!validToken) {
      return res.status(400).json({ message: "Invalid or already used token." });
    }

    // ✅ Check for duplicate email or phone
    const existingUser = await PublicUser.findOne({ $or: [{ email }, { phone }] });
    if (existingUser) {
      return res.status(409).json({
        message: existingUser.email === email
          ? "A user with this email already exists."
          : "A user with this phone number already exists."
      });
    }

    // ✅ Save new public user
    const newUser = new PublicUser({
      name,
      phone,
      email,
      password,
      passport
    });

    await newUser.save();

    // ✅ Mark token as used
    validToken.status = "used";
    await validToken.save();

    res.status(201).json({ message: "Public user registered successfully." });

  } catch (err) {
    console.error("🚨 Public Registration error:", err.message);
    if (err.code === 11000) {
      return res.status(409).json({ message: "Email or phone already exists." });
    }
    res.status(500).json({ message: "An error occurred. Please try again." });
  }
});

// ✅ Mark token as used
app.patch('/api/tokens/mark-used/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const updated = await Token.findOneAndUpdate(
      { token },
      { status: 'used' },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Token not found" });
    }

    res.json({ success: true, message: "Token marked as used", token: updated });
  } catch (err) {
    console.error("Mark-used error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
// POST /api/public/login

app.post("/api/public/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const publicUser = await PublicUser.findOne({ email });

    if (!publicUser) {
      return res.status(404).json({ message: "No user found with this email." });
    }

    if (publicUser.password !== password) {
      return res.status(401).json({ message: "Incorrect password." });
    }

    res.status(200).json({
      message: "Login successful",
      publicUser: {
        id: publicUser._id,
        name: publicUser.name,
        email: publicUser.email,
        phone: publicUser.phone,
        type: "public"
      }
    });
  } catch (error) {
    console.error("Public login error:", error.message);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
});

// Public Users Dashboard
app.get("/api/public-users/dashboard", async (req, res) => {
  try {
    const publicUsers = await PublicUser.find().select("-password");

    const formatted = publicUsers.map((user) => ({
      ...user._doc,
      passport: user.passport ? `${req.protocol}://${req.get("host")}/uploads/${user.passport}` : null,
    }));

    res.json({
      publicUsers: formatted,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ message: "Failed to load public user dashboard" });
  }
});

// Download Public Users List
app.get("/api/public-users/download", async (req, res) => {
  try {
    const publicUsers = await PublicUser.find().lean();

    if (!publicUsers.length) {
      return res.status(404).send("No public users found.");
    }

    const fields = [
      { label: "Name", value: "name" },
      { label: "Email", value: "email" },
      { label: "Phone", value: "phone" },
      { label: "Date Registered", value: "createdAt" }
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(publicUsers);

    res.header("Content-Type", "text/csv");
    res.attachment("public-users.csv");
    res.send(csv);
  } catch (err) {
    console.error("Download error:", err);
    res.status(500).send("Failed to download public user list.");
  }
});

// 🟢 Default Route
app.get("/", (req, res) => {
  res.send("✅ CBT System + Payment API is running!");
});

// 🟢 Start the Server
app.listen(PORT, () => {
  console.log(`🚀 Server is live on port ${PORT}`);
});
