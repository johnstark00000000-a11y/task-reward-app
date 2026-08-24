// ============================================
// TASK REWARD APP - BACKEND (FINAL - COPY PASTE)
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
db.settings({ ignoreUndefinedProperties: true });

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
// TASK ROUTES - PUBLIC (NO AUTH REQUIRED) ✅ FIXED
// ============================================
app.get('/api/tasks', async (req, res) => {
  try {
    const snapshot = await db.collection('tasks').get();
    const tasks = [];
    snapshot.forEach(doc => {
      const taskData = doc.data();
      if (taskData.active !== false) {
        tasks.push({ 
          id: doc.id,
          _id: doc.id,
          ...taskData 
        });
      }
    });
    res.json({ 
      success: true, 
      tasks,
      count: tasks.length 
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: error.message, tasks: [], success: false });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'alive', message: 'Server is running' });
});

// ============================================
// ADMIN ROUTES (Password: Asr@1234)
// ============================================
app.post('/api/admin/tasks', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.headers['admin-key'];
    const expectedKey = process.env.ADMIN_KEY || 'Asr@1234';

    if (!adminKey || adminKey !== expectedKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin Key' });
    }

    const { title, description, amount, reward, url, icon, time, category } = req.body;

    const taskData = {
      title: title || "New Task",
      description: description || "Complete this task",
      amount: Number(amount) || 0,
      reward: Number(reward || amount) || 0,
      url: url || "",
      icon: (icon && typeof icon === 'string') ? icon : "📌",
      time: Number(time) || 60,
      category: category || "General",
      completions: 0,
      createdAt: new Date(),
      active: true
    };

    Object.keys(taskData).forEach(key => {
      if (taskData[key] === undefined) delete taskData[key];
    });

    const taskDoc = await db.collection('tasks').add(taskData);
    
    console.log(`✅ Task added: ${taskData.title} (ID: ${taskDoc.id})`);

    res.status(201).json({
      success: true,
      message: 'Task added successfully',
      taskId: taskDoc.id,
      task: { id: taskDoc.id, ...taskData }
    });
  } catch (error) {
    console.error('Task creation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.headers['admin-key'];
    const expectedKey = process.env.ADMIN_KEY || 'Asr@1234';

    if (!adminKey || adminKey !== expectedKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin Key' });
    }

    const usersSnap = await db.collection('users').get();
    const tasksSnap = await db.collection('tasks').get();
    const withdrawalsSnap = await db.collection('withdrawals').get();

    let totalWithdrawals = 0;
    withdrawalsSnap.forEach(doc => {
      totalWithdrawals += doc.data().amount || 0;
    });

    res.json({
      success: true,
      stats: {
        totalUsers: usersSnap.size,
        totalTasks: tasksSnap.size,
        totalWithdrawals: totalWithdrawals
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/withdrawals', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.headers['admin-key'];
    const expectedKey = process.env.ADMIN_KEY || 'Asr@1234';

    if (!adminKey || adminKey !== expectedKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin Key' });
    }

    const withdrawalsSnap = await db.collection('withdrawals').get();
    const withdrawals = [];
    
    withdrawalsSnap.forEach(doc => {
      withdrawals.push({ id: doc.id, ...doc.data() });
    });

    res.json({ 
      success: true, 
      withdrawals,
      count: withdrawals.length 
    });
  } catch (error) {
    console.error('Withdrawals error:', error);
    res.status(500).json({ success: false, error: error.message, withdrawals: [] });
  }
});

app.post('/api/admin/withdrawals/add', async (req, res) => {
  try {
    const { amount, upi, userEmail, userId } = req.body;

    if (!amount || !upi) {
      return res.status(400).json({ success: false, error: 'Amount and UPI required' });
    }

    const withdrawalData = {
      amount: Number(amount),
      upi,
      userEmail: userEmail || 'unknown',
      userId: userId || 'anonymous',
      status: 'pending',
      createdAt: new Date()
    };

    const withdrawalDoc = await db.collection('withdrawals').add(withdrawalData);
    
    console.log(`✅ Withdrawal request: ₹${amount} to ${upi}`);

    res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted',
      withdrawalId: withdrawalDoc.id
    });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// ============================================
// SERVER START
// ============================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ Firestore connected`);
  console.log(`✅ Ready to handle requests`);
});

module.exports = app;
