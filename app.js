const DB_NAME = 'moa-organizer';
const DB_VERSION = 1;
const FILE_STORE = 'files';
const TODO_STORE = 'todos';

const state = {
  files: [],
  todos: [],
  category: 'all',
  search: '',
  sort: 'newest',
  view: 'grid',
  selectedDate: formatDateKey(new Date()),
};

const icons = {
  image: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="m5 17 4.5-4.5 3 3 2.2-2.2L19 17.6"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="13" height="13" rx="3"/><path d="m16.5 10 4-2v8l-4-2"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
  document: '<svg viewBox="0 0 24 24"><path d="M6 3.5h7l5 5V20H6z"/><path d="M13 3.5V9h5M9 13h6M9 16h6"/></svg>',
  other: '<svg viewBox="0 0 24 24"><path d="M6 3.5h7l5 5V20H6z"/><path d="M13 3.5V9h5"/></svg>',
};

let db;
let toastTimer;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  setDateLabels();
  bindEvents();
  renderWeek();
  try {
    db = await openDatabase();
    await reloadData();
  } catch (error) {
    console.error(error);
    showToast('저장소를 열지 못했어요. 브라우저 설정을 확인해주세요.');
  }
}

function bindEvents() {
  document.getElementById('fileInput').addEventListener('change', handleFiles);
  document.getElementById('searchInput').addEventListener('input', (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderFiles();
  });
  document.getElementById('sortSelect').addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderFiles();
  });
  document.querySelectorAll('.view-toggle').forEach((button) => button.addEventListener('click', () => {
    state.view = button.dataset.view;
    document.querySelectorAll('.view-toggle').forEach((item) => item.classList.toggle('active', item === button));
    renderFiles();
  }));
  document.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
    state.category = button.dataset.category;
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
    renderFiles();
    document.getElementById('filesSection').scrollIntoView({ behavior: 'smooth' });
  }));
  document.querySelectorAll('[data-scroll]').forEach((button) => button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.scroll);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (button.classList.contains('nav-item')) {
      state.category = 'all';
      document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === button));
      renderFiles();
    }
  }));
  document.getElementById('focusTodo').addEventListener('click', () => document.getElementById('todoSection').scrollIntoView({ behavior: 'smooth' }));
  document.getElementById('datePicker').addEventListener('change', (event) => {
    if (event.target.value) selectDate(event.target.value);
  });
  document.getElementById('todoForm').addEventListener('submit', addTodo);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FILE_STORE)) database.createObjectStore(FILE_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(TODO_STORE)) database.createObjectStore(TODO_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function put(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function remove(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function reloadData() {
  [state.files, state.todos] = await Promise.all([getAll(FILE_STORE), getAll(TODO_STORE)]);
  renderSummary();
  renderFiles();
  renderTodos();
}

async function handleFiles(event) {
  const selected = Array.from(event.target.files || []);
  if (!selected.length || !db) return;
  showToast(`${selected.length}개 파일을 정리하고 있어요.`);
  try {
    for (const file of selected) {
      await put(FILE_STORE, {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        name: file.name,
        type: file.type,
        category: getCategory(file),
        size: file.size,
        addedAt: Date.now(),
        blob: file,
      });
    }
    await reloadData();
    showToast(`${selected.length}개 파일을 추가했어요.`);
  } catch (error) {
    console.error(error);
    showToast('파일을 저장하지 못했어요. 저장 공간을 확인해주세요.');
  } finally {
    event.target.value = '';
  }
}

function getCategory(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (['pdf','doc','docx','hwp','hwpx','txt','rtf','xls','xlsx','csv','ppt','pptx'].includes(ext)) return 'document';
  return 'other';
}

function renderSummary() {
  const counts = state.files.reduce((result, file) => {
    result[file.category] = (result[file.category] || 0) + 1;
    return result;
  }, {});
  const totalSize = state.files.reduce((sum, file) => sum + file.size, 0);
  document.getElementById('totalFiles').textContent = state.files.length;
  document.getElementById('imageCount').textContent = counts.image || 0;
  document.getElementById('videoCount').textContent = counts.video || 0;
  document.getElementById('documentCount').textContent = (counts.document || 0) + (counts.audio || 0) + (counts.other || 0);
  document.getElementById('storageLabel').textContent = formatBytes(totalSize);
  document.getElementById('storageBar').style.width = `${Math.min(100, totalSize / (1024 * 1024 * 500) * 100)}%`;
  document.getElementById('recentStatus').textContent = state.files.length ? `최근 정리 ${formatRelativeDate(Math.max(...state.files.map((file) => file.addedAt)))}` : '첫 파일을 추가해보세요';
}

function renderFiles() {
  const grid = document.getElementById('fileGrid');
  const empty = document.getElementById('emptyFiles');
  let files = state.files.filter((file) => {
    const categoryMatch = state.category === 'all' || file.category === state.category;
    return categoryMatch && file.name.toLowerCase().includes(state.search);
  });
  files = [...files].sort((a, b) => {
    if (state.sort === 'name') return a.name.localeCompare(b.name, 'ko');
    if (state.sort === 'size') return b.size - a.size;
    return b.addedAt - a.addedAt;
  });
  const captionMap = { all: '추가한 파일을 한눈에 확인하세요', image: '사진 파일만 모아봤어요', video: '동영상 파일만 모아봤어요', document: '문서 파일만 모아봤어요' };
  document.getElementById('fileCaption').textContent = state.search ? `“${state.search}” 검색 결과 ${files.length}개` : (captionMap[state.category] || '선택한 파일을 모아봤어요');
  grid.classList.toggle('list-view', state.view === 'list');
  grid.innerHTML = '';
  empty.hidden = files.length > 0;
  grid.hidden = files.length === 0;
  files.forEach((file) => grid.appendChild(createFileCard(file)));
}

function createFileCard(file) {
  const card = document.createElement('article');
  card.className = 'file-card';
  card.tabIndex = 0;
  card.setAttribute('aria-label', `${file.name} 열기`);
  const preview = document.createElement('div');
  preview.className = 'file-preview';
  if (file.category === 'image' && file.blob) {
    const image = document.createElement('img');
    const url = URL.createObjectURL(file.blob);
    image.src = url;
    image.alt = '';
    image.onload = () => URL.revokeObjectURL(url);
    preview.appendChild(image);
  } else {
    preview.innerHTML = icons[file.category] || icons.other;
  }
  const info = document.createElement('div');
  info.className = 'file-info';
  const name = document.createElement('strong');
  name.className = 'file-name';
  name.textContent = file.name;
  const meta = document.createElement('div');
  meta.className = 'file-meta';
  meta.innerHTML = `<span>${formatBytes(file.size)}</span><span>${formatShortDate(file.addedAt)}</span>`;
  info.append(name, meta);
  const deleteButton = document.createElement('button');
  deleteButton.className = 'file-menu';
  deleteButton.type = 'button';
  deleteButton.setAttribute('aria-label', `${file.name} 삭제`);
  deleteButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6.5 7l1 14h9l1-14"/></svg>';
  deleteButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    await remove(FILE_STORE, file.id);
    await reloadData();
    showToast('파일을 정리함에서 삭제했어요.');
  });
  const open = () => openFile(file);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  card.append(preview, info, deleteButton);
  return card;
}

function openFile(file) {
  if (!file.blob) return;
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function selectDate(dateKey) {
  state.selectedDate = dateKey;
  document.getElementById('datePicker').value = dateKey;
  setDateLabels();
  renderWeek();
  renderTodos();
}

function renderWeek() {
  const strip = document.getElementById('weekStrip');
  strip.innerHTML = '';
  const center = parseDateKey(state.selectedDate);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  for (let offset = -3; offset <= 3; offset += 1) {
    const date = new Date(center);
    date.setDate(center.getDate() + offset);
    const key = formatDateKey(date);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day-button';
    button.classList.toggle('selected', key === state.selectedDate);
    button.classList.toggle('today', key === formatDateKey(new Date()));
    button.setAttribute('aria-label', `${date.getMonth() + 1}월 ${date.getDate()}일 ${dayNames[date.getDay()]}요일`);
    button.innerHTML = `<span>${dayNames[date.getDay()]}</span><strong>${date.getDate()}</strong>`;
    button.addEventListener('click', () => selectDate(key));
    strip.appendChild(button);
  }
}

async function addTodo(event) {
  event.preventDefault();
  const input = document.getElementById('todoInput');
  const text = input.value.trim();
  if (!text || !db) return;
  await put(TODO_STORE, {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    text,
    date: state.selectedDate,
    done: false,
    createdAt: Date.now(),
  });
  input.value = '';
  await reloadData();
  showToast('할 일을 추가했어요.');
}

function renderTodos() {
  const list = document.getElementById('todoList');
  const empty = document.getElementById('emptyTodos');
  const todos = state.todos.filter((todo) => todo.date === state.selectedDate).sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt - b.createdAt);
  list.innerHTML = '';
  empty.hidden = todos.length > 0;
  list.hidden = todos.length === 0;
  todos.forEach((todo) => {
    const item = document.createElement('li');
    item.className = `todo-item${todo.done ? ' done' : ''}`;
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'todo-check';
    check.setAttribute('aria-label', todo.done ? '완료 취소' : '완료로 표시');
    check.innerHTML = '<svg viewBox="0 0 24 24"><path d="m5 12 4 4 10-10"/></svg>';
    check.addEventListener('click', async () => {
      todo.done = !todo.done;
      await put(TODO_STORE, todo);
      await reloadData();
    });
    const text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = todo.text;
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'todo-delete';
    deleteButton.setAttribute('aria-label', '할 일 삭제');
    deleteButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6.5 7l1 14h9l1-14"/></svg>';
    deleteButton.addEventListener('click', async () => {
      await remove(TODO_STORE, todo.id);
      await reloadData();
    });
    item.append(check, text, deleteButton);
    list.appendChild(item);
  });
  const done = todos.filter((todo) => todo.done).length;
  document.getElementById('todoProgress').textContent = todos.length ? `${todos.length}개 중 ${done}개 완료` : '';
  const todayKey = formatDateKey(new Date());
  const remainingToday = state.todos.filter((todo) => todo.date === todayKey && !todo.done).length;
  const badge = document.getElementById('taskBadge');
  badge.hidden = remainingToday === 0;
  badge.textContent = remainingToday;
}

function setDateLabels() {
  const now = new Date();
  document.getElementById('todayLabel').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  const selected = parseDateKey(state.selectedDate);
  document.getElementById('selectedDateLabel').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(selected);
  document.getElementById('datePicker').value = state.selectedDate;
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatShortDate(timestamp) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric' }).format(new Date(timestamp));
}

function formatRelativeDate(timestamp) {
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  return `${days}일 전`;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}
