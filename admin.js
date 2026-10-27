// ===== Supabase 연결 정보 (공개 키만 사용) =====
const SUPABASE_URL = 'https://febwyrncdqyhuyjkjvgj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PQeoYkNyXtfj67Yc0rgbnA_sg7RRodY';
const BUCKET = 'resume';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const FILE_TYPES = { ...IMAGE_TYPES, 'application/pdf': 'pdf' };

// ===== 작은 도우미 =====
function $(id) { return document.getElementById(id); }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function showMsg(id, text, kind) {
  const box = $(id);
  box.textContent = text;
  box.classList.toggle('ok', kind === 'ok');
  box.classList.toggle('error', kind === 'error');
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* 저장 못 해도 이번 화면에서는 동작 */ }
}

// ===== 로그인 정보 (토큰) =====
let session = null;
try { session = JSON.parse(storageGet('resume_admin_session')); } catch { session = null; }

function saveSession(data) {
  session = data && {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    email: data.user ? data.user.email : session && session.email,
  };
  storageSet('resume_admin_session', session ? JSON.stringify(session) : null);
}

async function authRequest(grantType, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('로그인 실패');
  return res.json();
}

// 토큰이 곧 끝나면 새 토큰으로 바꾼다
async function refreshSession() {
  if (!session) return false;
  try {
    saveSession(await authRequest('refresh_token', { refresh_token: session.refresh_token }));
    return true;
  } catch {
    saveSession(null);
    return false;
  }
}

// 로그인한 사람의 토큰을 붙여서 요청을 보낸다
async function authFetch(url, options = {}, retried = false) {
  if (!session) throw new Error('로그인이 필요해요');
  if (session.expires_at - Date.now() < 60 * 1000) await refreshSession();
  if (!session) { showView('login'); throw new Error('로그인이 끝났어요'); }

  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && !retried && await refreshSession()) {
    return authFetch(url, options, true);
  }
  if (res.status === 401) {
    showView('login');
    throw new Error('로그인이 끝났어요. 다시 로그인해 주세요.');
  }
  return res;
}

// 데이터베이스 요청
async function db(path, { method = 'GET', body, prefer } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await authFetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// 바꾸거나 지운 줄이 하나도 없으면 = 규칙에 막힘
function mustChange(rows) {
  if (!rows || rows.length === 0) throw new Error('권한이 없어 바꾸지 못했어요');
  return rows;
}

// ===== 파일 올리기 =====
// 맞는 파일이면 null, 아니면 안내 문구를 돌려준다
function checkFile(file, types) {
  if (!types[file.type]) {
    return types === IMAGE_TYPES
      ? '이미지 파일(png, jpg, webp, gif)만 올릴 수 있어요.'
      : 'PDF나 이미지 파일만 올릴 수 있어요.';
  }
  if (file.size > MAX_SIZE) return '10MB가 넘는 파일은 올릴 수 없어요.';
  return null;
}

// 파일 이름은 영어·숫자로 새로 짓는다 (예: projects/1730000000000-a1b2c3.pdf)
async function uploadFile(folder, file) {
  const random = Math.random().toString(36).slice(2, 8);
  const path = `${folder}/${Date.now()}-${random}.${FILE_TYPES[file.type]}`;
  const res = await authFetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'cache-control': '3600' },
    body: file,
  });
  if (!res.ok) throw new Error(`파일을 올리지 못했어요 (${res.status})`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// 파일 칸: 고르면 검사하고, 맞지 않으면 비우고 안내한다
function watchFileInput(inputId, types, msgId, onPick) {
  $(inputId).addEventListener('change', () => {
    const file = $(inputId).files[0];
    if (!file) return;
    const problem = checkFile(file, types);
    if (problem) {
      $(inputId).value = '';
      showMsg(msgId, problem, 'error');
      return;
    }
    showMsg(msgId, '');
    onPick(file);
  });
}

function setPreview(boxId, url) {
  const box = $(boxId);
  box.replaceChildren();
  if (url) {
    const img = el('img');
    img.src = url;
    img.alt = '';
    box.append(img);
  }
}

// ===== 화면 바꾸기 =====
function showView(name) {
  $('login-view').hidden = name !== 'login';
  $('denied-view').hidden = name !== 'denied';
  $('admin-view').hidden = name !== 'admin';
}

async function start() {
  if (!session) { showView('login'); return; }
  try {
    // admins 표에서 "자기 줄"이 보이면 관리자
    const rows = await db('admins?select=user_id');
    if (rows.length === 0) {
      $('denied-who').textContent = `${session.email} 계정으로 로그인했어요.`;
      showView('denied');
      return;
    }
    $('admin-who').textContent = session.email;
    showView('admin');
    loadAll();
  } catch (err) {
    showView('login');
    showMsg('login-msg', err.message, 'error');
  }
}

// ===== 로그인 / 로그아웃 (회원 가입은 없음) =====
async function login() {
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  if (!email || !password) {
    showMsg('login-msg', '이메일과 비밀번호를 적어 주세요.', 'error');
    return;
  }
  $('login-btn').disabled = true;
  showMsg('login-msg', '로그인 중…');
  try {
    saveSession(await authRequest('password', { email, password }));
    $('login-password').value = '';
    showMsg('login-msg', '');
    await start();
  } catch {
    showMsg('login-msg', '이메일이나 비밀번호가 맞지 않아요.', 'error');
  }
  $('login-btn').disabled = false;
}

async function logout() {
  if (session) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
      });
    } catch { /* 이미 끝난 토큰이어도 화면에서는 로그아웃 */ }
  }
  saveSession(null);
  showView('login');
}

$('login-btn').addEventListener('click', login);
$('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) login();
});
document.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', logout));

// ===== 프로필 =====
const PROFILE_FIELDS = [
  ['name', '이름'],
  ['title', '직함'],
  ['career_badge', '경력 배지'],
  ['email', '이메일'],
  ['phone', '연락처'],
  ['location', '위치'],
  ['headline', '한 줄 소개 (이름이 들어가면 파란 밑줄)', 'wide'],
  ['intro', '소개 글', 'wide', 'textarea'],
  ['education', 'EDUCATION', 'wide', 'textarea'],
  ['skills', 'SKILLS & TOOLS (쉼표로 나누기)', 'wide'],
  ['experience', 'EXPERIENCE', 'wide', 'textarea'],
  ['quote', '맨 아래 인용', 'wide'],
];

PROFILE_FIELDS.forEach(([key, label, wide, kind]) => {
  const field = el('label', wide ? 'field wide' : 'field');
  const input = el(kind === 'textarea' ? 'textarea' : 'input');
  if (kind !== 'textarea') input.type = 'text';
  input.id = `pf-${key}`;
  field.append(el('span', '', label), input);
  $('profile-fields').append(field);
});

let photoUrl = null;   // 지금 저장된 사진 주소
let photoFile = null;  // 새로 고른 사진

watchFileInput('photo-file', IMAGE_TYPES, 'profile-msg', file => {
  photoFile = file;
  setPreview('photo-preview', URL.createObjectURL(file));
});

$('photo-remove').addEventListener('click', () => {
  photoFile = null;
  photoUrl = null;
  $('photo-file').value = '';
  setPreview('photo-preview', null);
  showMsg('profile-msg', '사진을 뺐어요. 저장을 눌러야 반영돼요.');
});

async function loadProfile() {
  try {
    const rows = await db('profile?select=*&id=eq.1');
    const p = rows[0] || {};
    PROFILE_FIELDS.forEach(([key]) => { $(`pf-${key}`).value = p[key] || ''; });
    photoUrl = p.photo_url || null;
    photoFile = null;
    $('photo-file').value = '';
    setPreview('photo-preview', photoUrl);
  } catch (err) {
    showMsg('profile-msg', `프로필을 불러오지 못했어요. ${err.message}`, 'error');
  }
}

async function saveProfile() {
  const saveBtn = $('profile-save');
  saveBtn.disabled = true;
  showMsg('profile-msg', '저장 중…');
  try {
    if (photoFile) photoUrl = await uploadFile('profile', photoFile);

    const row = { id: 1, photo_url: photoUrl, updated_at: new Date().toISOString() };
    PROFILE_FIELDS.forEach(([key]) => { row[key] = $(`pf-${key}`).value.trim(); });

    // 줄이 있으면 고치고, 없으면 새로 만든다
    mustChange(await db('profile?on_conflict=id', {
      method: 'POST',
      body: row,
      prefer: 'resolution=merge-duplicates,return=representation',
    }));
    photoFile = null;
    $('photo-file').value = '';
    setPreview('photo-preview', photoUrl);
    showMsg('profile-msg', '저장했어요.', 'ok');
  } catch (err) {
    showMsg('profile-msg', err.message, 'error');
  }
  saveBtn.disabled = false;
}

$('profile-save').addEventListener('click', saveProfile);

// ===== 포트폴리오 카드 =====
let projects = [];
let likeCounts = {};

// 편집 칸의 상태
let editingId = null;   // null 이면 "새 카드 추가"
let thumbUrl = null;
let thumbFile = null;
let attachUrl = null;
let attachFile = null;

watchFileInput('thumb-file', IMAGE_TYPES, 'p-msg', file => {
  thumbFile = file;
  setPreview('thumb-preview', URL.createObjectURL(file));
});
watchFileInput('attach-file', FILE_TYPES, 'p-msg', file => {
  attachFile = file;
  $('attach-current').textContent = `새 파일: ${file.name}`;
});

$('thumb-remove').addEventListener('click', () => {
  thumbUrl = null;
  thumbFile = null;
  $('thumb-file').value = '';
  setPreview('thumb-preview', null);
});
$('attach-remove').addEventListener('click', () => {
  attachUrl = null;
  attachFile = null;
  $('attach-file').value = '';
  showAttach();
});

function showAttach() {
  const box = $('attach-current');
  box.replaceChildren();
  if (attachUrl) {
    const a = el('a', '', '지금 파일 보기');
    a.href = attachUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    box.append(a);
  } else {
    box.textContent = '없음';
  }
}

function fillEditor(p) {
  editingId = p ? p.id : null;
  $('p-number').value = p ? p.number : '';
  $('p-category').value = p ? p.category : '';
  $('p-title').value = p ? p.title : '';
  $('p-description').value = p ? p.description : '';
  $('p-tags').value = p ? (p.tags || []).join(', ') : '';
  thumbUrl = p ? p.thumbnail_url : null;
  attachUrl = p ? p.file_url : null;
  thumbFile = null;
  attachFile = null;
  $('thumb-file').value = '';
  $('attach-file').value = '';
  setPreview('thumb-preview', thumbUrl);
  showAttach();

  $('editor-title').textContent = p ? `카드 수정: ${p.title}` : '새 카드 추가';
  $('p-save').textContent = p ? '수정 저장' : '카드 추가';
  $('p-cancel').hidden = !p;
  renderProjects();
}

$('p-cancel').addEventListener('click', () => {
  fillEditor(null);
  showMsg('p-msg', '');
});

async function saveProject() {
  const title = $('p-title').value.trim();
  if (!title) {
    showMsg('p-msg', '제목을 적어 주세요.', 'error');
    return;
  }
  const saveBtn = $('p-save');
  saveBtn.disabled = true;
  showMsg('p-msg', '저장 중…');
  try {
    if (thumbFile) thumbUrl = await uploadFile('projects', thumbFile);
    if (attachFile) attachUrl = await uploadFile('projects', attachFile);

    const row = {
      number: $('p-number').value.trim(),
      category: $('p-category').value.trim(),
      title,
      description: $('p-description').value.trim(),
      tags: $('p-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      thumbnail_url: thumbUrl,
      file_url: attachUrl,
    };

    if (editingId === null) {
      // 새 카드는 맨 뒤 순서로
      row.sort_order = projects.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1;
      mustChange(await db('projects', { method: 'POST', body: row, prefer: 'return=representation' }));
    } else {
      mustChange(await db(`projects?id=eq.${editingId}`, { method: 'PATCH', body: row, prefer: 'return=representation' }));
    }
    const wasNew = editingId === null;
    await loadProjects();
    fillEditor(null);
    showMsg('p-msg', wasNew ? '카드를 추가했어요.' : '수정했어요.', 'ok');
  } catch (err) {
    showMsg('p-msg', err.message, 'error');
  }
  saveBtn.disabled = false;
}

$('p-save').addEventListener('click', saveProject);

async function deleteProject(p) {
  if (!confirm(`"${p.title}" 카드를 지울까요?\n이 카드의 좋아요 기록도 함께 지워져요.`)) return;
  try {
    mustChange(await db(`projects?id=eq.${p.id}`, { method: 'DELETE', prefer: 'return=representation' }));
    if (editingId === p.id) fillEditor(null);
    await loadProjects();
    showMsg('p-msg', '카드를 지웠어요.', 'ok');
  } catch (err) {
    showMsg('p-msg', err.message, 'error');
  }
}

// 순서 올리기·내리기: 바꾼 뒤 1, 2, 3 … 으로 다시 매긴다
async function moveProject(index, step) {
  const target = index + step;
  if (target < 0 || target >= projects.length) return;
  const order = projects.slice();
  [order[index], order[target]] = [order[target], order[index]];
  try {
    for (let i = 0; i < order.length; i++) {
      if (order[i].sort_order !== i + 1) {
        mustChange(await db(`projects?id=eq.${order[i].id}`, {
          method: 'PATCH', body: { sort_order: i + 1 }, prefer: 'return=representation',
        }));
      }
    }
    showMsg('p-msg', '순서를 바꿨어요.', 'ok');
  } catch (err) {
    showMsg('p-msg', err.message, 'error');
  }
  await loadProjects();
}

function renderProjects() {
  const list = $('project-list');
  list.replaceChildren();
  if (projects.length === 0) {
    list.append(el('li', 'empty', '아직 카드가 없어요. 위에서 추가해 보세요.'));
    return;
  }
  projects.forEach((p, i) => {
    const li = el('li', p.id === editingId ? 'admin-item editing' : 'admin-item');

    const thumb = el('div', 'thumb');
    if (p.thumbnail_url) {
      const img = el('img');
      img.src = p.thumbnail_url;
      img.alt = '';
      thumb.append(img);
    }

    const info = el('div');
    info.append(
      el('div', 'item-meta', [p.number, p.category].filter(Boolean).join(' · ')),
      el('div', 'item-title', p.title),
      el('div', 'item-sub', `순서 ${p.sort_order} · ♥ 좋아요 ${likeCounts[p.id] || 0} · 첨부 ${p.file_url ? '있음' : '없음'}`),
    );

    const actions = el('div', 'row-actions');
    const up = button('▲ 올리기', 'btn-line', () => moveProject(i, -1));
    const down = button('▼ 내리기', 'btn-line', () => moveProject(i, 1));
    up.disabled = i === 0;
    down.disabled = i === projects.length - 1;
    actions.append(
      up,
      down,
      button('수정', 'btn-line', () => {
        fillEditor(p);
        showMsg('p-msg', '');
        $('editor-title').scrollIntoView({ behavior: 'smooth' });
      }),
      button('삭제', 'btn-line btn-danger', () => deleteProject(p)),
    );

    li.append(thumb, info, actions);
    list.append(li);
  });
}

// ===== 좋아요 =====
function renderLikes() {
  const list = $('like-list');
  list.replaceChildren();
  if (projects.length === 0) {
    list.append(el('li', 'empty', '카드가 없어요.'));
    return;
  }
  projects.forEach(p => {
    const li = el('li', 'admin-item gb-admin-item');
    const info = el('div');
    info.append(
      el('div', 'item-title', p.title),
      el('div', 'item-sub', `♥ 좋아요 ${likeCounts[p.id] || 0}`),
    );
    const reset = button('좋아요 초기화', 'btn-line btn-danger', () => resetLikes(p));
    reset.disabled = !likeCounts[p.id];
    li.append(info, reset);
    list.append(li);
  });
}

async function resetLikes(p) {
  if (!confirm(`"${p.title}" 카드의 좋아요 ${likeCounts[p.id] || 0}개를 모두 지울까요?`)) return;
  try {
    mustChange(await db(`likes?project_id=eq.${p.id}`, { method: 'DELETE', prefer: 'return=representation' }));
    await loadProjects();
    showMsg('like-msg', '좋아요를 초기화했어요.', 'ok');
  } catch (err) {
    showMsg('like-msg', err.message, 'error');
  }
}

async function loadProjects() {
  try {
    const [rows, likes] = await Promise.all([
      db('projects?select=*&order=sort_order.asc,id.asc'),
      db('likes?select=project_id'),
    ]);
    projects = rows;
    likeCounts = {};
    likes.forEach(l => { likeCounts[l.project_id] = (likeCounts[l.project_id] || 0) + 1; });
  } catch (err) {
    showMsg('p-msg', `카드를 불러오지 못했어요. ${err.message}`, 'error');
  }
  renderProjects();
  renderLikes();
}

// ===== 방명록 =====
async function loadGuestbook() {
  const list = $('gb-admin-list');
  try {
    const rows = await db('resume_guestbook?select=*&order=created_at.desc');
    list.replaceChildren();
    if (rows.length === 0) {
      list.append(el('li', 'empty', '방명록 글이 없어요.'));
      return;
    }
    rows.forEach(g => {
      const li = el('li', 'admin-item gb-admin-item');
      const info = el('div');
      const date = new Date(g.created_at).toLocaleString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      info.append(
        el('div', 'item-title', g.nickname),
        el('div', 'gb-msg', g.message),
        el('div', 'item-sub', date),
      );
      li.append(info, button('삭제', 'btn-line btn-danger', () => deleteGuest(g)));
      list.append(li);
    });
  } catch (err) {
    showMsg('gb-admin-msg', `방명록을 불러오지 못했어요. ${err.message}`, 'error');
  }
}

async function deleteGuest(g) {
  if (!confirm(`${g.nickname}님의 글을 지울까요?\n"${g.message}"`)) return;
  try {
    mustChange(await db(`resume_guestbook?id=eq.${g.id}`, { method: 'DELETE', prefer: 'return=representation' }));
    showMsg('gb-admin-msg', '글을 지웠어요.', 'ok');
    await loadGuestbook();
  } catch (err) {
    showMsg('gb-admin-msg', err.message, 'error');
  }
}

// ===== 시작 =====
function loadAll() {
  loadProfile();
  loadProjects();
  loadGuestbook();
}

start();
