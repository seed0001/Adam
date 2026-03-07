const express = require('express');
const router = express.Router();

// In-memory task storage (replace with database in production)
let tasks = [];
let taskId = 1;

// Get all tasks
router.get('/', (req, res) => {
  res.json(tasks);
});

// Add a new task
router.post('/', (req, res) => {
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const newTask = { id: taskId++, title };
  tasks.push(newTask);
  res.status(201).json(newTask);
});

// Update a task
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { title } = req.body;
  const taskIndex = tasks.findIndex(task => task.id === parseInt(id));
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  tasks[taskIndex].title = title;
  res.json(tasks[taskIndex]);
});

// Delete a task
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const taskIndex = tasks.findIndex(task => task.id === parseInt(id));
  if (taskIndex === -1) {
    return res.status(404).json({ error: 'Task not found' });
  }
  tasks = tasks.filter(task => task.id !== parseInt(id));
  res.status(204).send();
});

module.exports = router;