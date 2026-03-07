import React, { useState } from 'react';

function TaskForm({ onAdd, editingTask, onUpdate }) {
  const [title, setTitle] = useState(editingTask ? editingTask.title : '');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (title.trim()) {
      if (editingTask) {
        onUpdate({ ...editingTask, title });
      } else {
        onAdd(title);
      }
      setTitle('');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Enter task title"
        required
      />
      <button type="submit">{editingTask ? 'Update Task' : 'Add Task'}</button>
    </form>
  );
}

export default TaskForm;