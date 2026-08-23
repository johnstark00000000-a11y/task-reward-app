// ============================================
// TASK REWARD APP - BACKEND (FINAL FIXED)
// ============================================

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// FIREBASE SETUP
// ============================================
const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;

const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: privateKey,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs"
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true }); // Firestore crash fix

const auth = admin.auth();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Helper: Generate referral code
function generateReferralCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Middleware: Verify JWT
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ============================================
// AUTH ROUTES
// ============================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, phone } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const userRecord = await auth.createUser({ email, password, displayName: name });
    const referralCode = generateReferralCode();
    
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      name,
      phone: phone || '',
      wallet: 0,
      totalEarned: 0,
      tasksCompleted: 0,
      referralCode,
      referrals: [],
      referralEarnings: 0,
      createdAt: new Date(),
      verified: false,
      profileImage: '',
      approvalRate: 100
    });

    const token = jwt.sign({ userId: userRecord.uid }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, message: 'User registered successfully', token, user: { uid: userRecord.uid, email, name, referralCode } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const userRecord = await auth.getUserByEmail(email);
    const userDoc = await db.collection('users').doc(userRecord.uid).get();
    const userData = userDoc.data();

    const token = jwt.sign({ userId: userRecord.uid }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, message: 'Login successful', token, user: { uid: userRecord.uid, email: userData.email, name: userData.name, wallet: userData.wallet, referralCode: userData.referralCode } });
  } catch (error) {
    res.status(400).json({ error: 'Invalid credentials' });
  }
});

// ============================================
// USER ROUTES
// ============================================
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.userId).get();
    const userData = userDoc.data();
    if (!userData) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: userData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TASK ROUTES
// ============================================
app.get('/api/tasks', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection('tasks').get();
    const tasks = [];
    snapshot.forEach(doc => tasks.push({ id: doc.id, ...doc.data() }));
    res.json({ success: true, tasks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tasks/:taskId/complete', verifyToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const taskDoc = await db.collection('tasks').doc(taskId).get();
    if (!taskDoc.exists) return res.status(404).json({ error: 'Task not found' });

    const task = taskDoc.data();
    const amount = task.amount;

    const completionDoc = await db.collection('taskCompletions')
      .where('userId', '==', req.userId)
      .where('taskId', '==', taskId)
      .get();

    if (!completionDoc.empty) return res.status(400).json({ error: 'Task already completed' });

    const userDoc = await db.collection('users').doc(req.userId).get();
    const userData = userDoc.data();

    await db.collection('users').doc(req.userId).update({
      wallet: (userData.wallet || 0) + amount,
      totalEarned: (userData.totalEarned || 0) + amount,
      tasksCompleted: (userData.tasksCompleted || 0) + 1
    });

    await db.collection('taskCompletions').add({
      userId: req.userId,
      taskId,
      amount,
      completedAt: new Date(),
      status: 'completed'
    });

    await db.collection('tasks').doc(taskId).update({
      completions: (task.completions || 0) + 1
    });

    res.json({ success: true, message: `Task completed! Earned ₹${amount}`, newBalance: (userData.wallet || 0) + amount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN ROUTE (Password: Asr@1234)
// ============================================
app.post('/api/admin/tasks', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.headers['admin-key'];
    const expectedKey = process.env.ADMIN_KEY || 'Asr@1234';

    if (!adminKey || adminKey !== expectedKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid Admin Key' });
    }

    const { title, description, amount, reward, url, icon, time, category } = req.body;

    const taskData = {
      title: title || "New Task",
      description: description || "Complete this task",
      amount: Number(amount) || 0,
      reward: Number(reward || amount) || 0,
      url: url || "",
      icon: icon || "",
      time: Number(time) || 60,
      category: category || "General",
      completions: 0,
      createdAt: new Date(),
      active: true
    };

    const taskDoc = await db.collection('tasks').add(taskData);

    res.json({
      success: true,
      message: 'Task added successfully',
      taskId: taskDoc.id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SERVER START
// ============================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;
