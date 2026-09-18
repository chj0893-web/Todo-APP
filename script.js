/* =========================================================
 * My Tasks - script.js
 * 순수 Vanilla JS + LocalStorage 할 일 관리 앱
 *  - 추가 / 삭제 / 완료 토글 / 인라인 수정(더블클릭)
 *  - 카테고리(업무·개인·공부) + 키워드 기반 자동 분류
 *  - 대시보드(전체·카테고리별 진행률, 오늘 추가)
 *  - 필터 / 검색 / 정렬 / 드래그 앤 드롭 수동 정렬
 *  - 다크 모드, 키보드 단축키, JSON 내보내기/가져오기
 * ========================================================= */
(function () {
  'use strict';

  /* ---------- 상수 ---------- */
  const STORAGE_KEYS = {
    todos: 'myTasks.todos.v1',
    theme: 'myTasks.theme',
    sort: 'myTasks.sort',
  };

  const CATEGORIES = {
    work: { label: '업무', color: '#4A90E2' },
    personal: { label: '개인', color: '#27AE60' },
    study: { label: '공부', color: '#8E44AD' },
  };
  const CATEGORY_KEYS = Object.keys(CATEGORIES);
  const DEFAULT_CATEGORY = 'work';
  const FILTERS = ['all'].concat(CATEGORY_KEYS);
  const SORTS = ['newest', 'oldest', 'category', 'status', 'manual'];

  const MAX_TEXT_LENGTH = 200;
  const SEARCH_DEBOUNCE_MS = 120;
  const TIME_REFRESH_MS = 60 * 1000;
  const REMOVE_ANIMATION_FALLBACK_MS = 400;

  /** 키워드 기반 자동 카테고리 분류 사전 (앞쪽 카테고리가 우선 매칭) */
  const CATEGORY_KEYWORDS = {
    work: [
      '회의', '미팅', '보고', '기획', '프로젝트', '업무', '출근', '결재', '고객', '발표',
      '제안', '계약', '마감', '회사', '팀', '메일', '배포', '거래처', '품의', '견적',
      '세미나', '워크숍', '면접', '인터뷰', '출장', '결산', '보고서', '검토', '승인',
    ],
    study: [
      '공부', '학습', '강의', '수업', '시험', '자격증', '토익', '토플', '영어', '독서',
      '복습', '예습', '과제', '논문', '문제', '인강', '스터디', '코딩', '알고리즘', '단어',
      '필기', '책 읽기', '읽기', '암기', '학원', '수학', '중국어', '일본어',
    ],
    personal: [
      '운동', '병원', '장보기', '쇼핑', '청소', '빨래', '가족', '친구', '약속', '생일',
      '여행', '요리', '세탁', '은행', '미용실', '헬스', '산책', '저녁', '점심', '아침',
      '치과', '택배', '선물', '데이트', '영화', '요가', '러닝', '마트', '이사', '정리',
    ],
  };

  /* ---------- 상태 ---------- */
  const state = {
    /** @type {Array<{id:string,text:string,category:string,completed:boolean,createdAt:number}>} */
    todos: [],
    filter: 'all',
    search: '',
    sort: 'newest',
    editingId: null,
    lastAddedId: null,
    categoryTouched: false, // 사용자가 카테고리를 직접 고르면 자동 분류 중지
    dragId: null,
  };

  /* ---------- DOM ---------- */
  const $ = (selector) => document.querySelector(selector);
  const dom = {
    remainingBadge: $('#remaining-badge'),
    searchInput: $('#search-input'),
    themeToggle: $('#theme-toggle'),
    progressText: $('#progress-text'),
    progressBar: $('#progress-bar'),
    todayCount: $('#today-count'),
    filterGroup: $('#filter-group'),
    exportBtn: $('#export-btn'),
    importBtn: $('#import-btn'),
    importFile: $('#import-file'),
    clearCompletedBtn: $('#clear-completed-btn'),
    form: $('#todo-form'),
    input: $('#todo-input'),
    categorySelect: $('#category-select'),
    autoHint: $('#auto-category-hint'),
    sortSelect: $('#sort-select'),
    dragHint: $('#drag-hint'),
    list: $('#todo-list'),
    emptyMessage: $('#empty-message'),
    template: $('#todo-item-template'),
    statValues: {},
    statBars: {},
    filterCounts: {},
  };
  CATEGORY_KEYS.forEach((key) => {
    dom.statValues[key] = $(`[data-stat="${key}"]`);
    dom.statBars[key] = $(`[data-bar="${key}"]`);
  });
  FILTERS.forEach((key) => {
    dom.filterCounts[key] = $(`[data-count="${key}"]`);
  });

  /* ---------- 유틸 ---------- */

  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      console.warn('[MyTasks] localStorage 읽기 실패:', err);
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      console.error('[MyTasks] localStorage 저장 실패:', err);
      return false;
    }
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function isSameDay(a, b) {
    const da = new Date(a);
    const db = new Date(b);
    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    );
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatDate(date) {
    return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  }

  /** 생성 시각을 "N분 전 / N시간 전 / N일 전" 형태로 변환 */
  function relativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}일 전`;
    if (days < 30) return `${Math.floor(days / 7)}주 전`;
    const d = new Date(timestamp);
    return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
  }

  /** 저장소/파일에서 읽은 임의 객체를 안전한 Todo로 정규화. 유효하지 않으면 null */
  function sanitizeTodo(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string') return null;
    const text = raw.text.trim().slice(0, MAX_TEXT_LENGTH);
    if (!text) return null;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
      text,
      category: CATEGORY_KEYS.includes(raw.category) ? raw.category : DEFAULT_CATEGORY,
      completed: raw.completed === true || raw.isCompleted === true,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    };
  }

  /** 키워드 사전으로 카테고리를 추정. 매칭 없으면 null */
  function detectCategory(text) {
    const source = text.toLowerCase();
    if (!source.trim()) return null;
    for (const key of CATEGORY_KEYS) {
      if (CATEGORY_KEYWORDS[key].some((word) => source.includes(word.toLowerCase()))) {
        return key;
      }
    }
    return null;
  }

  /* ---------- 저장 / 로드 ---------- */

  function loadTodos() {
    const raw = storageGet(STORAGE_KEYS.todos);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('저장 데이터가 배열이 아닙니다.');
      return parsed.map(sanitizeTodo).filter(Boolean);
    } catch (err) {
      console.warn('[MyTasks] 손상된 저장 데이터를 초기화합니다:', err);
      return [];
    }
  }

  function saveTodos() {
    storageSet(STORAGE_KEYS.todos, JSON.stringify(state.todos));
  }

  function loadSort() {
    const saved = storageGet(STORAGE_KEYS.sort);
    return SORTS.includes(saved) ? saved : 'newest';
  }

  function saveSort() {
    storageSet(STORAGE_KEYS.sort, state.sort);
  }

  /* ---------- 테마 ---------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    dom.themeToggle.checked = theme === 'dark';
  }

  function initTheme() {
    let theme = storageGet(STORAGE_KEYS.theme);
    if (theme !== 'dark' && theme !== 'light') {
      theme =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    }
    applyTheme(theme);
  }

  /* ---------- 조회 / 정렬 ---------- */

  function sortTodos(list, sort) {
    const arr = list.slice();
    const newestFirst = (a, b) => b.createdAt - a.createdAt;
    switch (sort) {
      case 'newest':
        arr.sort(newestFirst);
        break;
      case 'oldest':
        arr.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'category':
        arr.sort(
          (a, b) =>
            CATEGORY_KEYS.indexOf(a.category) - CATEGORY_KEYS.indexOf(b.category) ||
            newestFirst(a, b)
        );
        break;
      case 'status':
        arr.sort((a, b) => Number(a.completed) - Number(b.completed) || newestFirst(a, b));
        break;
      case 'manual':
      default:
        break; // 배열 순서 그대로
    }
    return arr;
  }

  function getVisibleTodos() {
    const query = state.search.trim().toLowerCase();
    const filtered = state.todos.filter((todo) => {
      if (state.filter !== 'all' && todo.category !== state.filter) return false;
      if (query && !todo.text.toLowerCase().includes(query)) return false;
      return true;
    });
    return sortTodos(filtered, state.sort);
  }

  /* ---------- 렌더링 ---------- */

  function buildEditor(todo) {
    const wrap = document.createElement('div');
    wrap.className = 'todo-editor';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input';
    input.value = todo.text;
    input.maxLength = MAX_TEXT_LENGTH;
    input.setAttribute('aria-label', '할 일 수정');

    const select = document.createElement('select');
    select.className = 'edit-category';
    select.setAttribute('aria-label', '카테고리 수정');
    CATEGORY_KEYS.forEach((key) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = CATEGORIES[key].label;
      select.appendChild(option);
    });
    select.value = todo.category;

    const hint = document.createElement('span');
    hint.className = 'edit-hint';
    hint.textContent = 'Enter 저장 · Esc 취소';

    wrap.append(input, select, hint);
    return wrap;
  }

  function createItem(todo) {
    const li = dom.template.content.firstElementChild.cloneNode(true);
    li.dataset.id = todo.id;
    li.style.setProperty('--cat-color', CATEGORIES[todo.category].color);
    li.classList.toggle('is-completed', todo.completed);
    if (todo.id === state.lastAddedId) li.classList.add('is-new');
    li.querySelector('.todo-check').checked = todo.completed;

    if (state.editingId === todo.id) {
      li.classList.add('is-editing');
      li.draggable = false;
      li.querySelector('.todo-body').replaceChildren(buildEditor(todo));
      return li;
    }

    li.querySelector('.todo-text').textContent = todo.text;

    const tag = li.querySelector('.todo-tag');
    tag.textContent = CATEGORIES[todo.category].label;

    const time = li.querySelector('.todo-time');
    const created = new Date(todo.createdAt);
    time.dataset.ts = String(todo.createdAt);
    time.dateTime = created.toISOString();
    time.title = created.toLocaleString('ko-KR');
    time.textContent = relativeTime(todo.createdAt);

    return li;
  }

  function updateStats() {
    const total = state.todos.length;
    const done = state.todos.filter((t) => t.completed).length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    dom.progressText.textContent = `${done}/${total} 완료 (${percent}%)`;
    dom.progressBar.style.width = percent + '%';
    dom.progressBar.setAttribute('aria-valuenow', String(percent));

    CATEGORY_KEYS.forEach((key) => {
      const items = state.todos.filter((t) => t.category === key);
      const itemsDone = items.filter((t) => t.completed).length;
      const p = items.length === 0 ? 0 : Math.round((itemsDone / items.length) * 100);
      dom.statValues[key].textContent = `${itemsDone}/${items.length}`;
      dom.statBars[key].style.width = p + '%';
      dom.filterCounts[key].textContent = String(items.length);
    });
    dom.filterCounts.all.textContent = String(total);

    const now = Date.now();
    const today = state.todos.filter((t) => isSameDay(t.createdAt, now)).length;
    dom.todayCount.textContent = `${today}개`;

    dom.remainingBadge.textContent = `${total - done}개 남음`;
    dom.clearCompletedBtn.disabled = done === 0;
  }

  function updateFilterButtons() {
    dom.filterGroup.querySelectorAll('.filter-btn').forEach((btn) => {
      const active = btn.dataset.filter === state.filter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function updateEmptyMessage(visibleCount) {
    if (state.todos.length === 0) {
      dom.emptyMessage.textContent = '할 일이 없습니다. 추가해보세요!';
      dom.emptyMessage.hidden = false;
    } else if (visibleCount === 0) {
      dom.emptyMessage.textContent = '조건에 맞는 할 일이 없습니다.';
      dom.emptyMessage.hidden = false;
    } else {
      dom.emptyMessage.hidden = true;
    }
  }

  function render() {
    const visible = getVisibleTodos();
    const fragment = document.createDocumentFragment();
    visible.forEach((todo) => fragment.appendChild(createItem(todo)));
    dom.list.replaceChildren(fragment);

    updateEmptyMessage(visible.length);
    updateStats();
    updateFilterButtons();

    dom.sortSelect.value = state.sort;
    dom.dragHint.textContent =
      state.sort === 'manual'
        ? '항목을 드래그하여 순서를 바꿀 수 있습니다.'
        : '항목을 드래그하면 수동 정렬로 전환됩니다.';

    if (state.editingId) {
      const editInput = dom.list.querySelector('.edit-input');
      if (editInput) {
        editInput.focus();
        editInput.setSelectionRange(editInput.value.length, editInput.value.length);
      } else {
        state.editingId = null;
      }
    }
    state.lastAddedId = null;
  }

  function refreshTimes() {
    dom.list.querySelectorAll('.todo-time').forEach((el) => {
      el.textContent = relativeTime(Number(el.dataset.ts));
    });
    updateStats(); // 자정을 넘기면 "오늘 추가" 수치가 바뀜
  }

  /* ---------- CRUD ---------- */

  function addTodo(text, category) {
    const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
    if (!trimmed) return false;

    const todo = {
      id: generateId(),
      text: trimmed,
      category: CATEGORY_KEYS.includes(category) ? category : DEFAULT_CATEGORY,
      completed: false,
      createdAt: Date.now(),
    };
    // 수동 정렬 중이면 맨 위에, 그 외에는 정렬 함수가 순서를 결정
    if (state.sort === 'manual') state.todos.unshift(todo);
    else state.todos.push(todo);

    state.lastAddedId = todo.id;
    saveTodos();
    render();
    return true;
  }

  function toggleTodo(id) {
    const todo = state.todos.find((t) => t.id === id);
    if (!todo) return;
    todo.completed = !todo.completed;
    saveTodos();
    render();
  }

  function updateTodo(id, patch) {
    const todo = state.todos.find((t) => t.id === id);
    if (!todo) return;
    if (typeof patch.text === 'string') {
      const text = patch.text.trim().slice(0, MAX_TEXT_LENGTH);
      if (text) todo.text = text; // 공백이면 기존 텍스트 유지
    }
    if (CATEGORY_KEYS.includes(patch.category)) todo.category = patch.category;
    saveTodos();
  }

  /** 페이드 아웃 애니메이션 후 실제 삭제 */
  function removeTodos(ids) {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;

    const finish = () => {
      state.todos = state.todos.filter((t) => !idSet.has(t.id));
      if (idSet.has(state.editingId)) state.editingId = null;
      saveTodos();
      render();
    };

    const items = Array.from(dom.list.children).filter((li) => idSet.has(li.dataset.id));
    if (items.length === 0 || prefersReducedMotion()) {
      finish();
      return;
    }

    let pending = items.length;
    let finished = false;
    const done = () => {
      if (finished) return;
      pending -= 1;
      if (pending <= 0) {
        finished = true;
        finish();
      }
    };
    items.forEach((li) => {
      li.classList.add('is-removing');
      li.addEventListener('animationend', done, { once: true });
    });
    // 애니메이션 이벤트가 오지 않는 환경 대비
    setTimeout(() => {
      if (!finished) {
        finished = true;
        finish();
      }
    }, REMOVE_ANIMATION_FALLBACK_MS);
  }

  function clearCompleted() {
    const ids = state.todos.filter((t) => t.completed).map((t) => t.id);
    if (ids.length === 0) return;
    if (!window.confirm(`완료된 할 일 ${ids.length}개를 삭제할까요?\n삭제 후에는 되돌릴 수 없습니다.`)) return;
    removeTodos(ids);
  }

  function moveTodo(dragId, targetId, placeAfter) {
    // 다른 정렬 상태에서 드래그하면 현재 보이는 순서를 기준으로 수동 정렬로 전환
    if (state.sort !== 'manual') {
      state.todos = sortTodos(state.todos, state.sort);
      state.sort = 'manual';
      saveSort();
    }
    const from = state.todos.findIndex((t) => t.id === dragId);
    if (from < 0) return;
    const [item] = state.todos.splice(from, 1);
    let to = state.todos.findIndex((t) => t.id === targetId);
    if (to < 0) {
      state.todos.splice(from, 0, item);
      return;
    }
    if (placeAfter) to += 1;
    state.todos.splice(to, 0, item);
    saveTodos();
    render();
  }

  /* ---------- 인라인 수정 ---------- */

  function startEdit(id) {
    if (state.editingId === id) return;
    state.editingId = id;
    render();
  }

  function commitEdit(li) {
    const id = li.dataset.id;
    if (state.editingId !== id) return;
    const input = li.querySelector('.edit-input');
    const select = li.querySelector('.edit-category');
    updateTodo(id, { text: input ? input.value : '', category: select ? select.value : undefined });
    state.editingId = null;
    render();
  }

  function cancelEdit() {
    if (state.editingId === null) return;
    state.editingId = null;
    render();
  }

  /* ---------- 필터 / 검색 / 정렬 ---------- */

  function setFilter(filter) {
    if (!FILTERS.includes(filter) || state.filter === filter) return;
    state.filter = filter;
    render();
  }

  function setSort(sort) {
    if (!SORTS.includes(sort) || state.sort === sort) return;
    if (sort === 'manual') {
      // 현재 화면에 보이던 순서를 수동 정렬의 시작 순서로 고정
      state.todos = sortTodos(state.todos, state.sort);
      saveTodos();
    }
    state.sort = sort;
    saveSort();
    render();
  }

  /* ---------- 내보내기 / 가져오기 ---------- */

  function exportTodos() {
    const json = JSON.stringify(state.todos, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-tasks-backup-${formatDate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        window.alert('JSON 파일을 해석할 수 없습니다. 내보내기로 만든 파일인지 확인해 주세요.');
        return;
      }
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.todos)
          ? parsed.todos
          : null;
      if (!list) {
        window.alert('올바른 형식이 아닙니다. 할 일 배열(JSON)이어야 합니다.');
        return;
      }

      const imported = list.map(sanitizeTodo).filter(Boolean);
      const seen = new Set();
      imported.forEach((t) => {
        if (seen.has(t.id)) t.id = generateId();
        seen.add(t.id);
      });

      if (state.todos.length > 0) {
        const backup = window.confirm(
          `현재 할 일 ${state.todos.length}개가 있습니다.\n가져오기 전에 현재 데이터를 JSON 파일로 백업할까요?`
        );
        if (backup) exportTodos();
        const replace = window.confirm(
          `기존 데이터를 가져온 ${imported.length}개 항목으로 교체합니다. 계속할까요?`
        );
        if (!replace) return;
      }

      state.todos = imported;
      state.editingId = null;
      saveTodos();
      render();
      window.alert(`${imported.length}개의 할 일을 가져왔습니다.`);
    };
    reader.onerror = () => window.alert('파일을 읽는 중 오류가 발생했습니다.');
    reader.readAsText(file);
  }

  /* ---------- 자동 카테고리 분류 ---------- */

  function showAutoHint(category) {
    dom.autoHint.textContent = `자동 분류: ${CATEGORIES[category].label} (다른 카테고리를 직접 선택할 수 있습니다)`;
    dom.autoHint.hidden = false;
  }

  function hideAutoHint() {
    dom.autoHint.hidden = true;
    dom.autoHint.textContent = '';
  }

  function applyAutoCategory() {
    if (state.categoryTouched) return;
    const detected = detectCategory(dom.input.value);
    if (detected) {
      dom.categorySelect.value = detected;
      showAutoHint(detected);
    } else {
      hideAutoHint();
    }
  }

  /* ---------- 드래그 앤 드롭 ---------- */

  function clearDropMarkers() {
    dom.list.querySelectorAll('.drop-before, .drop-after').forEach((el) => {
      el.classList.remove('drop-before', 'drop-after');
    });
  }

  function bindDragAndDrop() {
    dom.list.addEventListener('dragstart', (e) => {
      const li = e.target.closest && e.target.closest('.todo-item');
      if (!li || state.editingId) {
        e.preventDefault();
        return;
      }
      state.dragId = li.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', li.dataset.id);
      requestAnimationFrame(() => li.classList.add('is-dragging'));
    });

    dom.list.addEventListener('dragover', (e) => {
      if (!state.dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const li = e.target.closest('.todo-item');
      clearDropMarkers();
      if (!li || li.dataset.id === state.dragId) return;
      const rect = li.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      li.classList.add(after ? 'drop-after' : 'drop-before');
    });

    dom.list.addEventListener('dragleave', (e) => {
      if (!dom.list.contains(e.relatedTarget)) clearDropMarkers();
    });

    dom.list.addEventListener('drop', (e) => {
      if (!state.dragId) return;
      e.preventDefault();
      const li = e.target.closest('.todo-item');
      const targetId = li ? li.dataset.id : null;
      const after = li ? li.classList.contains('drop-after') : false;
      clearDropMarkers();
      if (targetId && targetId !== state.dragId) moveTodo(state.dragId, targetId, after);
      state.dragId = null;
    });

    dom.list.addEventListener('dragend', () => {
      clearDropMarkers();
      dom.list.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
      state.dragId = null;
    });
  }

  /* ---------- 이벤트 바인딩 ---------- */

  function bindEvents() {
    // 추가
    dom.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ok = addTodo(dom.input.value, dom.categorySelect.value);
      if (ok) {
        dom.input.value = '';
        state.categoryTouched = false;
        hideAutoHint();
      }
      dom.input.focus();
    });

    // 키워드 자동 분류
    dom.input.addEventListener('input', applyAutoCategory);
    dom.categorySelect.addEventListener('change', () => {
      state.categoryTouched = true;
      hideAutoHint();
    });

    // 목록: 완료 토글 / 삭제 (이벤트 위임)
    dom.list.addEventListener('click', (e) => {
      const li = e.target.closest('.todo-item');
      if (!li) return;
      if (e.target.classList.contains('todo-check')) {
        toggleTodo(li.dataset.id);
      } else if (e.target.closest('.btn-delete')) {
        removeTodos([li.dataset.id]);
      }
    });

    // 목록: 더블클릭으로 인라인 수정
    dom.list.addEventListener('dblclick', (e) => {
      if (!e.target.classList.contains('todo-text')) return;
      const li = e.target.closest('.todo-item');
      if (li) startEdit(li.dataset.id);
    });

    // 편집기: Enter 저장 / Esc 취소
    dom.list.addEventListener('keydown', (e) => {
      const editor = e.target.closest('.todo-editor');
      if (!editor) return;
      const li = editor.closest('.todo-item');
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit(li);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });

    // 편집기: 포커스가 편집기 밖으로 나가면 저장
    dom.list.addEventListener('focusout', (e) => {
      const editor = e.target.closest('.todo-editor');
      if (!editor) return;
      if (e.relatedTarget && editor.contains(e.relatedTarget)) return;
      commitEdit(editor.closest('.todo-item'));
    });

    // 검색 (디바운스)
    let searchTimer = null;
    dom.searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.search = dom.searchInput.value;
        render();
      }, SEARCH_DEBOUNCE_MS);
    });

    // 정렬
    dom.sortSelect.addEventListener('change', () => setSort(dom.sortSelect.value));

    // 필터
    dom.filterGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (btn) setFilter(btn.dataset.filter);
    });

    // 데이터 관리
    dom.exportBtn.addEventListener('click', exportTodos);
    dom.importBtn.addEventListener('click', () => dom.importFile.click());
    dom.importFile.addEventListener('change', () => {
      const file = dom.importFile.files && dom.importFile.files[0];
      if (file) importFromFile(file);
      dom.importFile.value = ''; // 같은 파일을 다시 선택할 수 있도록 초기화
    });
    dom.clearCompletedBtn.addEventListener('click', clearCompleted);

    // 다크 모드
    dom.themeToggle.addEventListener('change', () => {
      const theme = dom.themeToggle.checked ? 'dark' : 'light';
      applyTheme(theme);
      storageSet(STORAGE_KEYS.theme, theme);
    });

    // 키보드 단축키: Alt+N 입력창 포커스, Alt+1~4 필터 전환
    document.addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code === 'KeyN') {
        e.preventDefault();
        dom.input.focus();
        dom.input.select();
        return;
      }
      const match = /^Digit([1-4])$/.exec(e.code);
      if (match) {
        e.preventDefault();
        setFilter(FILTERS[Number(match[1]) - 1]);
      }
    });

    // 다른 탭에서의 변경 동기화
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEYS.todos || e.key === null) {
        state.todos = loadTodos();
        state.editingId = null;
        render();
      } else if (e.key === STORAGE_KEYS.theme && (e.newValue === 'dark' || e.newValue === 'light')) {
        applyTheme(e.newValue);
      }
    });

    bindDragAndDrop();
  }

  /* ---------- 초기화 ---------- */

  function init() {
    initTheme();
    state.sort = loadSort();
    state.todos = loadTodos();
    bindEvents();
    render();
    setInterval(refreshTimes, TIME_REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
