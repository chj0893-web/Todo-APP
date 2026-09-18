// app.js – Minimalist Browser Todo
// --------------------------------------------------
// 1️⃣ State & Data Schema
const STORAGE_KEY = 'app_todos_v1';
let todos = [];

// Todo 객체 구조 (예시)
// {
//   id: string (crypto.randomUUID()),
//   text: string,
//   category: 'personal' | 'work',
//   isCompleted: boolean,
//   createdAt: number (timestamp)
// }

// --------------------------------------------------
// 2️⃣ LocalStorage 연동
function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      todos = [];
      return;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      todos = parsed;
    } else {
      console.warn('Invalid data format in LocalStorage, resetting.');
      todos = [];
    }
  } catch (e) {
    console.error('Failed to parse LocalStorage data:', e);
    todos = [];
  }
}

function saveTodos() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  } catch (e) {
    console.error('Failed to save todos to LocalStorage:', e);
  }
}

// --------------------------------------------------
// 3️⃣ XSS 방어 – HTML Escape
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return map[ch];
  });
}

// --------------------------------------------------
// 4️⃣ UI Elements
const todoForm = document.getElementById('todo-form');
const todoInput = document.getElementById('todo-input');
const categorySelect = document.getElementById('category-select');
const todoList = document.getElementById('todo-list');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');

// --------------------------------------------------
// 5️⃣ Render 함수 – UI 업데이트
function render() {
  // Render list
  todoList.innerHTML = todos.map(todo => {
    const badgeClass = todo.category === 'personal' ? 'personal' : 'work';
    const badgeLabel = todo.category === 'personal' ? '개인' : '업무';
    return `
      <li data-id="${todo.id}" class="${todo.isCompleted ? 'completed' : ''}">
        <input type="checkbox" class="toggle-check" ${todo.isCompleted ? 'checked' : ''} />
        <span class="badge ${badgeClass}">${badgeLabel}</span>
        <span class="todo-text" tabindex="0">${escapeHtml(todo.text)}</span>
        <button class="btn-delete" aria-label="삭제">🗑️</button>
      </li>`;
  }).join('');

  updateProgress();
}

// --------------------------------------------------
// 6️⃣ Progress Bar 계산
function updateProgress() {
  const total = todos.length;
  if (total === 0) {
    progressBar.style.width = '0%';
    progressText.textContent = '0% (0/0)';
    return;
  }
  const completed = todos.filter(t => t.isCompleted).length;
  const percent = Math.round((completed / total) * 100);
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}% (${completed}/${total})`;
}

// --------------------------------------------------
// 7️⃣ CRUD 로직
// 7-1 Add Todo
todoForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = todoInput.value.trim();
  if (!text) return; // 공백 입력 방지

  const newTodo = {
    id: crypto.randomUUID(),
    text,
    category: categorySelect.value,
    isCompleted: false,
    createdAt: Date.now()
  };
  todos.push(newTodo);
  saveTodos();
  render();
  todoInput.value = '';
});

// 7-2 Event Delegation (toggle & delete & inline edit)
let editingId = null; // 현재 인라인 편집 중인 아이템 ID

todoList.addEventListener('click', e => {
  const target = e.target;
  const li = target.closest('li');
  if (!li) return;
  const id = li.dataset.id;

  // 체크박스 토글
  if (target.classList.contains('toggle-check')) {
    todos = todos.map(t => t.id === id ? { ...t, isCompleted: !t.isCompleted } : t);
    saveTodos();
    render();
    return;
  }

  // 삭제 버튼
  if (target.classList.contains('btn-delete')) {
    todos = todos.filter(t => t.id !== id);
    saveTodos();
    render();
    return;
  }
});

// 7-3 인라인 수정 – 텍스트 클릭 시 input으로 변환
todoList.addEventListener('dblclick', e => {
  const target = e.target;
  if (!target.classList.contains('todo-text')) return;
  const li = target.closest('li');
  const id = li.dataset.id;
  const todo = todos.find(t => t.id === id);
  if (!todo) return;

  // 이미 편집 중이면 무시
  if (editingId) return;
  editingId = id;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = todo.text;
  input.className = 'edit-input';
  input.style.flex = '1';

  const finishEdit = () => {
    const newText = input.value.trim();
    if (newText) {
      todo.text = newText;
      saveTodos();
    }
    editingId = null;
    render();
  };

  const cancelEdit = () => {
    editingId = null;
    render();
  };

  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      finishEdit();
    } else if (ev.key === 'Escape') {
      cancelEdit();
    }
  });

  input.addEventListener('blur', finishEdit);

  // Replace text span with input element
  li.replaceChild(input, target);
  input.focus();
});

// --------------------------------------------------
// 8️⃣ 초기화
document.addEventListener('DOMContentLoaded', () => {
  loadTodos();
  render();
});

// End of app.js
