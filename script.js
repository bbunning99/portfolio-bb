// ===== Supabase 연결 정보 (공개 키만 사용) =====
const SUPABASE_URL = 'https://febwyrncdqyhuyjkjvgj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PQeoYkNyXtfj67Yc0rgbnA_sg7RRodY';

// Supabase 데이터베이스에 요청을 보내는 함수
async function db(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const error = new Error(`요청 실패 (${res.status})`);
    error.status = res.status;
    throw error;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ===== 브라우저에 저장하는 값 (좋아요용) =====
function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 저장 못 해도 화면은 동작 */ }
}

// 이 브라우저만의 번호. 처음 한 번 만들어서 저장해 둔다.
function getClientId() {
  let id = storageGet('resume_client_id');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
    storageSet('resume_client_id', id);
  }
  return id;
}
const clientId = getClientId();

// 이 브라우저에서 좋아요를 누른 카드 번호들
const likedIds = new Set(JSON.parse(storageGet('resume_liked') || '[]'));
function saveLiked() {
  storageSet('resume_liked', JSON.stringify([...likedIds]));
}

// ===== 작은 도우미 =====
function $(id) { return document.getElementById(id); }

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.3C1 8.2 3.2 4.5 7 4.5c2.1 0 3.6 1.1 5 3 1.4-1.9 2.9-3 5-3 3.8 0 6 3.7 4.5 7.2C19.5 16.4 12 21 12 21z"/></svg>';

// ===== 프로필 =====
async function loadProfile() {
  try {
    const rows = await db('profile?select=*&id=eq.1');
    const p = rows[0];
    if (!p) {
      $('name').textContent = '프로필이 아직 없어요';
      return;
    }

    $('name').textContent = p.name;
    $('title').textContent = p.title;
    $('career-badge').textContent = p.career_badge;
    $('career-badge').hidden = !p.career_badge;

    $('info-name').textContent = p.name;
    $('info-email').textContent = p.email;
    $('info-phone').textContent = p.phone;
    $('info-location').textContent = p.location;

    // 사진이 있으면 넣고, 없으면 회색 자리 그대로
    $('photo').replaceChildren();
    if (p.photo_url) {
      const img = el('img');
      img.src = p.photo_url;
      img.alt = `${p.name} 프로필 사진`;
      $('photo').append(img);
    }

    renderHeadline(p.headline, p.name);
    $('intro').textContent = p.intro;
    $('education').textContent = p.education;
    $('experience').textContent = p.experience;
    $('quote').textContent = p.quote;

    // SKILLS & TOOLS 는 쉼표로 나눠서 작은 칩으로
    const skills = $('skills');
    skills.replaceChildren();
    p.skills.split(',').map(s => s.trim()).filter(Boolean)
      .forEach(s => skills.append(el('span', 'chip', s)));
  } catch (err) {
    $('name').textContent = '프로필을 불러오지 못했어요';
    console.error(err);
  }
}

// 한 줄 소개 안의 이름에 파란 밑줄을 붙인다
function renderHeadline(headline, name) {
  const box = $('headline');
  box.replaceChildren();
  const at = name ? headline.indexOf(name) : -1;
  if (at === -1) {
    box.textContent = headline;
    return;
  }
  box.append(
    headline.slice(0, at),
    el('span', 'hl', name),
    headline.slice(at + name.length),
  );
}

// ===== 포트폴리오 카드 =====
async function loadProjects() {
  const cards = $('cards');
  try {
    const [projects, likes] = await Promise.all([
      db('projects?select=*&order=sort_order.asc,id.asc'),
      db('likes?select=project_id,client_id'),
    ]);

    // 카드별 좋아요 수 세기 + 이 브라우저가 누른 카드 기억
    const counts = {};
    likes.forEach(l => {
      counts[l.project_id] = (counts[l.project_id] || 0) + 1;
      if (l.client_id === clientId) likedIds.add(l.project_id);
    });
    saveLiked();

    cards.replaceChildren();
    if (projects.length === 0) {
      cards.append(el('p', 'empty', '아직 등록된 포트폴리오가 없어요.'));
      return;
    }
    projects.forEach(p => cards.append(makeCard(p, counts[p.id] || 0)));
  } catch (err) {
    cards.replaceChildren(el('p', 'empty', '포트폴리오를 불러오지 못했어요.'));
    console.error(err);
  }
}

function makeCard(p, likeCount) {
  const card = el('article', 'card');

  // 카드를 누르면: 첨부 파일 → 없으면 썸네일 이미지를 새 탭으로
  const link = p.file_url || p.thumbnail_url;
  const open = el('button', 'card-open');
  open.type = 'button';
  if (link) {
    open.addEventListener('click', () => window.open(link, '_blank', 'noopener'));
  } else {
    open.disabled = true;
  }

  // 브라우저 창 모양 썸네일
  const browser = el('div', 'browser');
  const bar = el('div', 'browser-bar');
  bar.append(el('span'), el('span'), el('span'));
  const view = el('div', 'browser-view');
  if (p.thumbnail_url) {
    const img = el('img');
    img.src = p.thumbnail_url;
    img.alt = `${p.title} 썸네일`;
    img.loading = 'lazy';
    view.append(img);
  }
  browser.append(bar, view);

  const body = el('div', 'card-body');
  const meta = [p.number, p.category].filter(Boolean).join(' · ');
  body.append(
    el('p', 'card-meta', meta),
    el('h4', 'card-title', p.title),
    el('p', 'card-desc', p.description),
  );
  const tags = el('div', 'tags');
  (p.tags || []).forEach(t => tags.append(el('span', 'tag', t)));
  body.append(tags);

  open.append(browser, body);

  // 하트 좋아요 버튼
  const like = el('button', 'like');
  like.type = 'button';
  like.innerHTML = HEART;
  const num = el('span', '', String(likeCount));
  like.append(num);
  setLiked(like, likedIds.has(p.id));
  like.addEventListener('click', () => pressLike(p.id, like, num));

  card.append(open, like);
  return card;
}

function setLiked(button, liked) {
  button.classList.toggle('liked', liked);
  button.setAttribute('aria-pressed', String(liked));
  button.setAttribute('aria-label', liked ? '좋아요 누름' : '좋아요');
}

async function pressLike(projectId, button, num) {
  if (likedIds.has(projectId)) return; // 같은 카드는 한 번만
  button.disabled = true;
  try {
    await db('likes', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ project_id: projectId, client_id: clientId }),
    });
    num.textContent = String(Number(num.textContent) + 1);
    likedIds.add(projectId);
  } catch (err) {
    // 409 = 이미 누른 기록이 있음 → 누른 것으로 표시만
    if (err.status === 409) likedIds.add(projectId);
    else console.error(err);
  }
  saveLiked();
  setLiked(button, likedIds.has(projectId));
  button.disabled = false;
}

// ===== 방명록 =====
function makeGuestItem(g) {
  const li = el('li', 'gb-item');
  const head = el('div', 'gb-head');
  const date = new Date(g.created_at).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  head.append(el('span', 'gb-nick', g.nickname), el('span', 'gb-date', date));
  li.append(head, el('p', 'gb-msg', g.message));
  return li;
}

async function loadGuestbook() {
  const list = $('gb-list');
  try {
    const rows = await db('resume_guestbook?select=*&order=created_at.desc');
    list.replaceChildren();
    if (rows.length === 0) {
      list.append(el('li', 'empty', '첫 번째 한마디를 남겨 주세요.'));
      return;
    }
    rows.forEach(g => list.append(makeGuestItem(g)));
  } catch (err) {
    list.replaceChildren(el('li', 'empty', '방명록을 불러오지 못했어요.'));
    console.error(err);
  }
}

function showStatus(text, isError) {
  const status = $('gb-status');
  status.textContent = text;
  status.classList.toggle('error', Boolean(isError));
}

async function submitGuestbook() {
  const nickname = $('gb-nickname').value.trim();
  const message = $('gb-message').value.trim();
  if (!nickname || !message) {
    showStatus('별명과 한마디를 모두 적어 주세요.', true);
    return;
  }

  const button = $('gb-submit');
  button.disabled = true;
  showStatus('남기는 중…');
  try {
    const rows = await db('resume_guestbook', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ nickname, message }),
    });
    // 목록 맨 위에 바로 보이게
    const list = $('gb-list');
    list.querySelector('.empty')?.remove();
    list.prepend(makeGuestItem(rows[0]));
    $('gb-message').value = '';
    showStatus('고마워요! 한마디가 남겨졌어요.');
  } catch (err) {
    showStatus('남기지 못했어요. 잠시 후 다시 해 주세요.', true);
    console.error(err);
  }
  button.disabled = false;
}

$('gb-submit').addEventListener('click', submitGuestbook);
$('gb-message').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) submitGuestbook();
});

// ===== 시작 =====
loadProfile();
loadProjects();
loadGuestbook();
