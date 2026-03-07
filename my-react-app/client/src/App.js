import React, { useState, useEffect } from 'react';
import TaskList from './components/TaskList';
import TaskForm from './components/TaskForm';

function App() {
  const [tasks, setTasks] = useState([]);
  const [editingTask, setEditingTask] = useState(null);

  useEffect(() => {
    // Fetch tasks from API (placeholder)
    const fetchTasks = async () => {
      try {
        const response = await fetch('http://localhost:5000/api/tasks');
        const data = await response.json();
        setTasks(data);
      } catch (error) {
        console.error('Error fetching tasks:', error);
      }
    };
    fetchTasks();
  }, []);

  const addTask = async (title) => {
    try {
      const response = await fetch('http://localhost:5000/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const newTask = await response.json();
      setTasks([...tasks, newTask]);
    } catch (error) {
      console.error('Error adding task:', error);
    }
  };

  const deleteTask = async (id) => {
    try {
      await fetch(`http://localhost:5000/api/tasks/${id}`, { method: 'DELETE' });
      setTasks(tasks.filter(task => task.id !== id));
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const editTask = (task) => {
    setEditingTask(task);
  };

  const updateTask = async (updatedTask) => {
    try {
      const response = await fetch(`http://localhost:5000/api/tasks/${updatedTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedTask),
      });
      const data = await response.json();
      setTasks(tasks.map(task => (task.id === updatedTask.id ? data : task)));
      setEditingTask(null);
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  return (
    <div className="App">
      <h1>Task Manager</h1>
      <TaskForm onAdd={addTask} editingTask={editingTask} onUpdate={updateTask} />
      <TaskList tasks={tasks} onDelete={deleteTask} onEdit={editTask} />
    </div>
  );
}

export default App;