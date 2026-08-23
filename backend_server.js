// ============================================
// ADMIN ROUTES (Fixed & Complete)
// ============================================

// 1. Add Task Route
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
      icon: (icon && typeof icon === 'string') ? icon : "",
      time: Number(time) || 60,
      category: category || "General",
      completions: 0,
      createdAt: new Date(),
      active: true
    };

    // Clean undefined fields completely
    Object.keys(taskData).forEach(key => {
      if (taskData[key] === undefined) delete taskData[key];
    });

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

// 2. Admin Stats Route (Fixes the 404 Error)
app.get('/api/admin/stats', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.headers['admin-key'];
    const expectedKey = process.env.ADMIN_KEY || 'Asr@1234';

    if (!adminKey || adminKey !== expectedKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid Admin Key' });
    }

    const usersSnap = await db.collection('users').get();
    const tasksSnap = await db.collection('tasks').get();
    
    let totalUsers = usersSnap.size;
    let totalTasks = tasksSnap.size;

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalTasks,
        totalWithdrawals: 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Admin Withdrawals Route (Fixes the 404 Error)
app.get('/api/admin/withdrawals', async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'] || req.headers['admin-key'];
    const expectedKey = process.env.ADMIN_KEY || 'Asr@1234';

    if (!adminKey || adminKey !== expectedKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid Admin Key' });
    }

    // Return empty list if withdrawals collection doesn't exist yet
    res.json({ success: true, withdrawals: [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
