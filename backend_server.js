// ============================================
// TASK REWARD APP - BACKEND (FREE HOSTING)
// Tech Stack: Node.js + Express + Firebase
// Hosting: Railway.app or Render.com (FREE)
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
// FIREBASE SETUP (Completely Free)
// ============================================

const serviceAccount = {
  type: "service_account",
  project_id: "your-firebase-project-id",
  private_key_id: "your-key-id",
  private_key: "your-private-key",
  client_email: "your-email@appspot.gserviceaccount.com",
  client_id: "your-client-id",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs"
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const auth = admin.auth();

// JWT Secret (Use env variable)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// ============================================
// HELPER FUNCTIONS
// ============================================

// Generate referral code
function generateReferralCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Middleware to verify JWT token
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

// Register User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, phone } = req.body;

    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create Firebase user
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name
    });

    // Create user document in Firestore
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

    // Create JWT token
    const token = jwt.sign({ userId: userRecord.uid }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        uid: userRecord.uid,
        email,
        name,
        referralCode
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Verify with Firebase
    const userRecord = await auth.getUserByEmail(email);
    
    // Get user data from Firestore
    const userDoc = await db.collection('users').doc(userRecord.uid).get();
    const userData = userDoc.data();

    // Create JWT token
    const token = jwt.sign({ userId: userRecord.uid }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        uid: userRecord.uid,
        email: userData.email,
        name: userData.name,
        wallet: userData.wallet,
        referralCode: userData.referralCode
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(400).json({ error: 'Invalid credentials' });
  }
});

// ============================================
// USER ROUTES
// ============================================

// Get User Profile
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.userId).get();
    const userData = userDoc.data();

    if (!userData) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      user: userData
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update User Profile
app.put('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const { name, phone, profileImage } = req.body;

    await db.collection('users').doc(req.userId).update({
      name: name || undefined,
      phone: phone || undefined,
      profileImage: profileImage || undefined,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TASK ROUTES
// ============================================

// Get All Tasks
app.get('/api/tasks', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection('tasks').get();
    const tasks = [];

    snapshot.forEach(doc => {
      tasks.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      tasks
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Complete Task & Add Money
app.post('/api/tasks/:taskId/complete', verifyToken, async (req, res) => {
  try {
    const { taskId } = req.params;

    // Get task details
    const taskDoc = await db.collection('tasks').doc(taskId).get();
    if (!taskDoc.exists) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const task = taskDoc.data();
    const amount = task.amount;

    // Check if user already completed this task
    const completionDoc = await db.collection('taskCompletions')
      .where('userId', '==', req.userId)
      .where('taskId', '==', taskId)
      .get();

    if (!completionDoc.empty) {
      return res.status(400).json({ error: 'Task already completed' });
    }

    // Add money to user wallet
    const userDoc = await db.collection('users').doc(req.userId).get();
    const userData = userDoc.data();

    await db.collection('users').doc(req.userId).update({
      wallet: (userData.wallet || 0) + amount,
      totalEarned: (userData.totalEarned || 0) + amount,
      tasksCompleted: (userData.tasksCompleted || 0) + 1
    });

    // Record task completion
    await db.collection('taskCompletions').add({
      userId: req.userId,
      taskId,
      amount,
      completedAt: new Date(),
      status: 'completed'
    });

    // Update task completion count
    await db.collection('tasks').doc(taskId).update({
      completions: (task.completions || 0) + 1
    });

    res.json({
      success: true,
      message: `Task completed! You earned ₹${amount}`,
      newBalance: (userData.wallet || 0) + amount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// WALLET & TRANSACTION ROUTES
// ============================================

// Get Wallet Balance
app.get('/api/wallet', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.userId).get();
    const userData = userDoc.data();

    res.json({
      success: true,
      balance: userData.wallet || 0,
      totalEarned: userData.totalEarned || 0,
      tasksCompleted: userData.tasksCompleted || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Transaction History
app.get('/api/transactions', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection('taskCompletions')
      .where('userId', '==', req.userId)
      .orderBy('completedAt', 'desc')
      .limit(50)
      .get();

    const transactions = [];
    snapshot.forEach(doc => {
      transactions.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      transactions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// REFERRAL ROUTES
// ============================================

// Get Referral Code
app.get('/api/referral/code', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.userId).get();
    const userData = userDoc.data();

    res.json({
      success: true,
      referralCode: userData.referralCode,
      referralEarnings: userData.referralEarnings || 0,
      referrals: userData.referrals || [],
      referralLink: `https://yourdomain.com/?ref=${userData.referralCode}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add Referral
app.post('/api/referral/add', async (req, res) => {
  try {
    const { referralCode, newUserId } = req.body;

    // Find user with this referral code
    const referrerSnapshot = await db.collection('users')
      .where('referralCode', '==', referralCode)
      .limit(1)
      .get();

    if (referrerSnapshot.empty) {
      return res.status(404).json({ error: 'Referral code not found' });
    }

    const referrerId = referrerSnapshot.docs[0].id;
    const referrerData = referrerSnapshot.docs[0].data();

    // Add to referrer's referral list
    await db.collection('users').doc(referrerId).update({
      referrals: [...(referrerData.referrals || []), newUserId]
    });

    res.json({
      success: true,
      message: 'Referral added successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// WITHDRAWAL ROUTES
// ============================================

// Request Withdrawal
app.post('/api/withdrawal/request', verifyToken, async (req, res) => {
  try {
    const { amount, method, details } = req.body;

    // Validate amount
    if (amount < 100 || amount > 50000) {
      return res.status(400).json({ error: 'Amount must be between ₹100 and ₹50,000' });
    }

    // Check balance
    const userDoc = await db.collection('users').doc(req.userId).get();
    const userData = userDoc.data();

    if ((userData.wallet || 0) < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Create withdrawal request
    const withdrawalId = await db.collection('withdrawals').add({
      userId: req.userId,
      amount,
      method,
      details,
      status: 'pending',
      requestedAt: new Date(),
      processedAt: null
    });

    // Deduct from wallet
    await db.collection('users').doc(req.userId).update({
      wallet: (userData.wallet || 0) - amount
    });

    // Record transaction
    await db.collection('taskCompletions').add({
      userId: req.userId,
      type: 'withdrawal',
      amount: -amount,
      description: `Withdrawal via ${method}`,
      completedAt: new Date(),
      status: 'pending'
    });

    res.json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      withdrawalId: withdrawalId.id,
      newBalance: (userData.wallet || 0) - amount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Withdrawal History
app.get('/api/withdrawal/history', verifyToken, async (req, res) => {
  try {
    const snapshot = await db.collection('withdrawals')
      .where('userId', '==', req.userId)
      .orderBy('requestedAt', 'desc')
      .limit(50)
      .get();

    const withdrawals = [];
    snapshot.forEach(doc => {
      withdrawals.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      withdrawals
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PAYMENT ROUTES (Razorpay Test Mode - FREE)
// ============================================

const Razorpay = require('razorpay');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_1234567890',
  key_secret: process.env.RAZORPAY_SECRET || 'test_secret_key'
});

// Create Payment Order
app.post('/api/payment/create-order', verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;

    const options = {
      amount: amount * 100, // Razorpay expects amount in paise
      currency: 'INR',
      receipt: `receipt_${req.userId}_${Date.now()}`,
      payment_capture: 1
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount / 100,
      currency: order.currency
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify Payment
app.post('/api/payment/verify', verifyToken, async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    // Verify signature
    const crypto = require('crypto');
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_SECRET || 'test_secret_key')
      .update(razorpayOrderId + '|' + razorpayPaymentId)
      .digest('hex');

    if (generated_signature === razorpaySignature) {
      // Payment successful
      res.json({
        success: true,
        message: 'Payment verified successfully'
      });
    } else {
      res.status(400).json({ error: 'Payment verification failed' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN ROUTES (For you to manage tasks)
// ============================================

// Add Task (Admin)
app.post('/api/admin/tasks', async (req, res) => {
  try {
    const { adminKey } = req.headers;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { title, description, amount, icon, time, category } = req.body;

    const taskDoc = await db.collection('tasks').add({
      title,
      description,
      amount,
      icon,
      time,
      category,
      completions: 0,
      createdAt: new Date(),
      active: true
    });

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
// ERROR HANDLING
// ============================================

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('📱 Task Reward App Backend is Live!');
});

module.exports = app;
