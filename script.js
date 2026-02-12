const tg = window.Telegram.WebApp;
tg.expand();

const API = "https://api-eju8g7j209.amvera.io";

// --- НАЧАЛО ФАЙЛА ---
// --- НАЧАЛО ФАЙЛА ---
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const API = "https://api-eju8g7j209.amvera.io";

// Берем ID из телеграма. Если мы в браузере (тест), будет 0
const tgUserId = tg.initDataUnsafe?.user?.id || 0;
const userId = tgUserId; 

// Если ID нет (открыли просто в браузере), покажем баннер
if (!userId) {
    document.getElementById("guestBanner")?.classList.remove("hidden");
}

console.log("WebApp loaded. UserID:", userId);
// --- КОНЕЦ ЗАМЕНЫ ---

let currentAlbumCode = "";
let currentAlbumName = "";
let currentPerms = { 
    role: 'viewer', 
    is_owner: false, 
    is_moderator: false, 
    can_upload: false, 
    can_delete_any: false,
    is_opened: false 
};

let camStream = null;
let cameraFacing = "environment";

// album photos cache for fullscreen swipe
let albumPhotos = []; // [{url, uploaded_by}]
let fullIndex = 0;

// zoom state (for current slide)
let zoom = 1;
let panX = 0;
let panY = 0;

// swipe/gesture state
let dragging = false;
let startX = 0;
let startY = 0;
let dx = 0;
let lastTapAt = 0;

let pinching = false;
let pinchStartDist = 0;
let pinchStartZoom = 1;

const $ = (id) => document.getElementById(id);

function toast(msg){
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> t.classList.add("hidden"), 2300);
}

function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[m]);
}

function showAlbumsScreen(){
  $("screenAlbums").classList.remove("hidden");
  $("screenAlbum").classList.add("hidden");
  $("topTitle").textContent = "Альбомы";
  $("topMenuBtn").onclick = () => toast("Открой альбом, чтобы управлять 🙂");
}

function showAlbumScreen(){
  $("screenAlbums").classList.add("hidden");
  $("screenAlbum").classList.remove("hidden");
  $("topTitle").textContent = currentAlbumName || "Альбом";
  $("topMenuBtn").onclick = () => openManage();
}

async function loadAlbums(){
  const list = $("albumList");
  if (!list) return;
  list.innerHTML = "<div class='text-center opacity-50 py-10'>Загрузка...</div>";

  try {
    // Стучимся по новому адресу
    const res = await fetch(`${API}/api/albums/${userId}`);
    const data = await res.json();
    list.innerHTML = "";

    if(!data || data.length === 0){
      list.innerHTML = "<div class='text-center opacity-30 py-10'>Альбомов пока нет</div>";
      return;
    }

    data.forEach(a => {
      const card = document.createElement("div");
      card.className = "btn glass rounded-3xl p-5 flex items-center justify-between mb-3 w-full";
      card.onclick = () => openAlbum(a.code, a.name);
      card.innerHTML = `
        <div class="flex items-center gap-4 text-left">
          <div class="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-2xl shadow-inner">🖼</div>
          <div>
            <div class="font-bold text-lg leading-tight">${a.name}</div>
            <div class="text-xs opacity-50 uppercase tracking-widest">${a.role === 'owner' ? 'Создатель' : 'Участник'}</div>
          </div>
        </div>
        <div class="opacity-30">→</div>
      `;
      list.appendChild(card);
    });
  } catch(e) {
    list.innerHTML = "<div class='text-center text-red-400 py-10'>Ошибка связи</div>";
  }
}

window.openAlbum = async function(code, name){
  currentAlbumCode = code;
  currentAlbumName = name;
  showAlbumScreen();
  $("topTitle").textContent = name;

  try {
    const res = await fetch(`${API}/api/album/info/${code}/${userId}`);
    const data = await res.json();
    if (data.perms) {
      currentPerms = data.perms;
      const camBtn = $("cameraBtn");
      // Блокируем камеру если нельзя
      if (!currentPerms.can_upload) {
        camBtn.style.opacity = "0.3";
        camBtn.style.pointerEvents = "none";
      } else {
        camBtn.style.opacity = "1";
        camBtn.style.pointerEvents = "auto";
      }
      // Прячем настройки если ты не админ
      if (currentPerms.is_owner || currentPerms.is_moderator) {
        $("topMenuBtn").classList.remove("hidden");
      } else {
        $("topMenuBtn").classList.add("hidden");
      }
    }
  } catch (e) { console.error(e); }

  await loadPhotos();
}

async function loadPhotos(){
  $("photoGrid").innerHTML = "";
  $("permBadge").textContent = "Загрузка…";
  $("uploadHint").textContent = "";

  const r = await fetch(`${API}/api/photos/${currentAlbumCode}?user_id=${userId}`);
  const d = await r.json();

  if(!r.ok){
    toast(d?.detail || "Ошибка загрузки");
    currentPerms = {is_owner:false, can_upload:false, can_delete:false};
    $("permBadge").textContent = "Нет доступа";
    return;
  }

  currentPerms = d.perms || {is_owner:false, can_upload:false, can_delete:false};
  const badge = currentPerms.is_owner
    ? "👑 Владелец"
    : (currentPerms.can_upload ? "✅ Участник (загрузка)" : "👀 Просмотр");
  $("permBadge").textContent = badge;

  $("uploadHint").textContent = currentPerms.can_upload
    ? "Можно добавлять фото. Удаление: владелец/модератор/автор фото."
    : "Нет прав на загрузку. Попроси владельца выдать доступ.";

  const items = d.items || [];
  albumPhotos = items.map(p => ({ url: p.url, uploaded_by: p.uploaded_by || 0 }));

  // ✅ для 100+ фото — без pop-анимаций (иначе может дергать)
  const animateTiles = items.length <= 60;

  $("photoGrid").innerHTML = items.map((p,i) => `
    <div class="photo-tile ${animateTiles ? "pop" : ""}"
         style="${animateTiles ? `animation-delay:${i*12}ms` : ""}"
         onclick="openFullAtUrl('${p.url}')">
      <img src="${p.url}" loading="lazy" decoding="async" />
    </div>
  `).join("");
}

// ===== FULLSCREEN SWIPE + ZOOM (без анимации перехода) =====
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function canDeletePhoto(photo){
  return !!(currentPerms.is_owner || currentPerms.can_delete || (photo?.uploaded_by && photo.uploaded_by === userId));
}

function getViewerRect(){
  return $("fullViewer").getBoundingClientRect();
}

function getCurrentImgEl(){
  return document.querySelector('#fullTrack .fullSlide[data-pos="cur"] img');
}

function applyZoom(animated=true){
  const img = getCurrentImgEl();
  if(!img) return;
  img.style.transition = animated ? `transform var(--dur2) var(--e)` : "none";
  img.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
  if(animated){
    setTimeout(()=> { if(img) img.style.transition = ""; }, 300);
  }
}

function resetZoom(animated=true){
  zoom = 1; panX = 0; panY = 0;
  applyZoom(animated);
}

function renderFullSlides(){
  const prev = albumPhotos[fullIndex - 1] || null;
  const cur  = albumPhotos[fullIndex] || null;
  const next = albumPhotos[fullIndex + 1] || null;

  const track = $("fullTrack");
  track.innerHTML = `
    <div class="fullSlide" data-pos="prev">
      ${prev ? `<img class="fullImg" src="${prev.url}" draggable="false">` : `<div class="text-xs opacity-60">—</div>`}
    </div>
    <div class="fullSlide" data-pos="cur">
      ${cur ? `<img class="fullImg" src="${cur.url}" draggable="false">` : `<div class="text-xs opacity-60">—</div>`}
    </div>
    <div class="fullSlide" data-pos="next">
      ${next ? `<img class="fullImg" src="${next.url}" draggable="false">` : `<div class="text-xs opacity-60">—</div>`}
    </div>
  `;

  const w = getViewerRect().width;
  // ✅ ставим "cur" сразу (без анимации)
  track.style.transform = `translate3d(${-w}px, 0, 0)`;

  const photo = albumPhotos[fullIndex] || null;
  $("fullDelete").classList.toggle("hidden", !canDeletePhoto(photo));

  resetZoom(false);
}

function openFullAt(index){
  if(!albumPhotos.length) return;
  fullIndex = clamp(index, 0, albumPhotos.length - 1);
  renderFullSlides();
  $("fullModal").classList.add("show");
}

window.openFullAtUrl = function(url){
  const idx = albumPhotos.findIndex(p => p.url === url);
  openFullAt(idx >= 0 ? idx : 0);
}

function toggleZoom(){
  if(zoom === 1){
    zoom = 2.2; panX = 0; panY = 0;
  }else{
    zoom = 1; panX = 0; panY = 0;
  }
  applyZoom(true);
}

function distance(t1, t2){
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.hypot(dx, dy);
}

function onTouchStart(e){
  if(!$("fullModal").classList.contains("show")) return;

  if(e.touches.length === 2){
    pinching = true;
    pinchStartDist = distance(e.touches[0], e.touches[1]);
    pinchStartZoom = zoom;
    dragging = false;
    return;
  }

  if(e.touches.length === 1){
    const now = Date.now();
    if(now - lastTapAt < 280){
      lastTapAt = 0;
      toggleZoom();
      e.preventDefault();
      return;
    }
    lastTapAt = now;

    dragging = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0;
  }
}

function onTouchMove(e){
  if(!$("fullModal").classList.contains("show")) return;

  const rect = getViewerRect();

  if(pinching && e.touches.length === 2){
    const d = distance(e.touches[0], e.touches[1]);
    const scale = pinchStartZoom * (d / pinchStartDist);
    zoom = clamp(scale, 1, 4);

    const maxPanX = (zoom - 1) * rect.width * 0.35;
    const maxPanY = (zoom - 1) * rect.height * 0.35;
    panX = clamp(panX, -maxPanX, maxPanX);
    panY = clamp(panY, -maxPanY, maxPanY);

    applyZoom(false);
    e.preventDefault();
    return;
  }

  if(!dragging || e.touches.length !== 1) return;

  const x = e.touches[0].clientX;
  const y = e.touches[0].clientY;
  dx = x - startX;

  // zoomed -> панорамирование
  if(zoom > 1){
    const mx = (zoom - 1) * rect.width * 0.35;
    const my = (zoom - 1) * rect.height * 0.35;
    panX = clamp(panX + (x - startX) * 0.9, -mx, mx);
    panY = clamp(panY + (y - startY) * 0.9, -my, my);
    startX = x; startY = y;
    applyZoom(false);
    e.preventDefault();
    return;
  }

  // swipe track while dragging
  const w = rect.width;
  const base = -w;
  $("fullTrack").style.transform = `translate3d(${base + dx}px, 0, 0)`;
  e.preventDefault();
}

function onTouchEnd(){
  if(!$("fullModal").classList.contains("show")) return;

  if(pinching){
    pinching = false;
    if(zoom < 1.02){
      zoom = 1; panX = 0; panY = 0;
      applyZoom(true);
    }
    return;
  }

  if(!dragging) return;
  dragging = false;

  if(zoom > 1) return;

  const rect = getViewerRect();
  const threshold = rect.width * 0.18;

  // ✅ ВАЖНО: без анимации — просто меняем индекс и ререндерим
  if(dx <= -threshold && fullIndex < albumPhotos.length - 1){
    fullIndex++;
  }else if(dx >= threshold && fullIndex > 0){
    fullIndex--;
  }
  renderFullSlides(); // вернет в центр сразу
  dx = 0;
}

function attachFullGestures(){
  const viewer = $("fullViewer");
  viewer.addEventListener("touchstart", onTouchStart, { passive:false });
  viewer.addEventListener("touchmove", onTouchMove, { passive:false });
  viewer.addEventListener("touchend", onTouchEnd, { passive:true });
  viewer.addEventListener("touchcancel", onTouchEnd, { passive:true });
}

async function downloadCurrent(){
  const photo = albumPhotos[fullIndex];
  if(!photo?.url){ toast("Нет файла"); return; }
  try{
    const resp = await fetch(photo.url, { mode: "cors" });
    const blob = await resp.blob();
    const ext = (blob.type && blob.type.includes("png")) ? "png" : "jpg";
    const name = `iventry_${Date.now()}.${ext}`;

    const a = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    toast("⬇️ Скачивание началось");
  }catch(_){
    tg.openLink(photo.url);
    toast("Открыл файл для сохранения");
  }
}

async function deleteCurrentFull(){
  const photo = albumPhotos[fullIndex];
  if(!photo?.url) return;

  if(!canDeletePhoto(photo)){
    toast("Нет прав на удаление");
    return;
  }

  const ok = confirm("Удалить это фото?");
  if(!ok) return;

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("file_url", photo.url);

  const r = await fetch(`${API}/api/photo/delete`, { method:"POST", body: fd });
  const d = await r.json();
  if(!r.ok){
    toast(d?.detail || "Не удалось удалить");
    return;
  }

  toast("🗑 Удалено");
  await loadPhotos();
  if(albumPhotos.length === 0){
    $("fullModal").classList.remove("show");
    return;
  }
  fullIndex = clamp(fullIndex, 0, albumPhotos.length - 1);
  renderFullSlides();
}

// ===== Upload / Camera =====
function galleryPicker(){
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.onchange = async () => {
    if(!inp.files || !inp.files[0]) return;
    await uploadFile(inp.files[0]);
  };
  inp.click();
}

async function uploadFile(file){
  if(!currentPerms.can_upload){
    toast("Нет прав на загрузку");
    return;
  }
  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("file", file);

  const r = await fetch(`${API}/api/upload`, { method:"POST", body: fd });
  const d = await r.json();
  if(!r.ok){
    toast(d?.detail || "Ошибка загрузки");
    return;
  }
  toast("✅ Загружено");
  await loadPhotos();
}

async function startCamera(){
  $("cameraModal").classList.add("show");

  if(camStream){
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }

  try{
    const v = $("camVideo");
    v.muted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.autoplay = true;

    const constraintsA = { video: { facingMode: cameraFacing }, audio: false };
    const constraintsB = { video: { facingMode: { ideal: cameraFacing } }, audio: false };

    try{
      camStream = await navigator.mediaDevices.getUserMedia(constraintsA);
    }catch(_){
      camStream = await navigator.mediaDevices.getUserMedia(constraintsB);
    }

    v.srcObject = camStream;

    await new Promise((resolve) => {
      const done = () => resolve();
      v.onloadedmetadata = done;
      setTimeout(done, 500);
    });

    v.style.transform = (cameraFacing === "user") ? "scaleX(-1)" : "none";
    await v.play();
  }catch(e){
    console.log(e);
    toast("Камера недоступна — жми «Фолбэк»");
  }
}

function stopCamera(){
  $("cameraModal").classList.remove("show");
  const v = $("camVideo");
  try{ v.pause(); }catch(_){}
  v.srcObject = null;
  if(camStream){
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
}

async function flipCamera(){
  cameraFacing = (cameraFacing === "environment") ? "user" : "environment";
  await startCamera();
}

async function takeShot(){
  try{
    const v = $("camVideo");
    if(!v || !v.videoWidth){
      toast("Нет видео — жми «Фолбэк»");
      return;
    }

    const canvas = $("camCanvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");

    if(cameraFacing === "user"){
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }else{
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    }

    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.92));
    if(!blob){
      toast("Не удалось сделать фото");
      return;
    }
    await uploadFile(new File([blob], "camera.jpg", { type:"image/jpeg" }));
  }catch(e){
    console.log(e);
    toast("Ошибка камеры — жми «Фолбэк»");
  }
}

function cameraFallback(){
  stopCamera();
  galleryPicker();
}

// ===== Manage / share =====
function openManage(){
  if(!currentAlbumCode) return;

  $("renameBtn").style.display = currentPerms.is_owner ? "block" : "none";
  $("deleteAlbumBtn").style.display = currentPerms.is_owner ? "block" : "none";
  $("leaveBtn").style.display = currentPerms.is_owner ? "none" : "block";

  $("manageModal").classList.add("show");
}

function getShareRights(){
  const can_upload = $("shareCanUpload").checked;
  const can_delete = $("shareCanDelete").checked;
  const flags = (can_upload ? "1" : "0") + (can_delete ? "1" : "0");
  return { can_upload, can_delete, flags };
}

function getShareMaxUses(){
  const raw = ($("shareMaxUses").value || "").trim();
  let n = parseInt(raw, 10);
  if(Number.isNaN(n)) n = 20;
  if(n < 0) n = 20;
  if(n > 10000) n = 10000;
  return n;
}

async function createInviteLink(canUpload, canDelete, maxUses){
  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("can_upload", canUpload ? "true" : "false");
  fd.append("can_delete", canDelete ? "true" : "false");
  fd.append("max_uses", String(maxUses));
  fd.append("ttl_hours", "168");

  const r = await fetch(`${API}/api/invite/create`, { method:"POST", body: fd });
  const d = await r.json();
  if(!r.ok){
    toast(d?.detail || "Не удалось создать ссылку");
    return null;
  }
  return d.link;
}

async function shareByLink(){
  if(!currentPerms.is_owner){
    toast("Только владелец может делиться");
    return;
  }
  const rights = getShareRights();
  const maxUses = getShareMaxUses();

  const link = await createInviteLink(rights.can_upload, rights.can_delete, maxUses);
  if(!link) return;

  tg.openTelegramLink(
    `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Зайди в мой альбом 👇")}`
  );
  toast("Выбери чат и отправь ссылку");
}

window.changeRole = async function(targetId, newRole) {
  if (!confirm(`Изменить роль пользователя на ${newRole}?`)) return;

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("target_id", targetId);
  fd.append("new_role", newRole);

  const res = await fetch(`${API}/api/member/set_role`, { method: "POST", body: fd });
  if (res.ok) {
    toast("Роль изменена ✅");
    await openMembers(); // Обновляем список
  } else {
    toast("Ошибка при смене роли");
  }
}

function sharePersonToBot(){
  if(!currentPerms.is_owner){
    toast("Только владелец может добавлять людей");
    return;
  }
  const rights = getShareRights();
  const deep = `https://t.me/Iventry_Bot?start=pick_${currentAlbumCode}_${rights.flags}`;
  tg.openTelegramLink(deep);
  toast("Открыл бота — нажми «Выбрать человека»");
}

async function renameAlbum(){
  if(!currentPerms.is_owner){
    toast("Только владелец может переименовать");
    return;
  }
  const newName = prompt("Новое название альбома:", currentAlbumName || "");
  if(newName === null) return;

  const name = (newName || "").trim();
  if(!name){ toast("Название пустое"); return; }

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("new_name", name);

  const resp = await fetch(`${API}/api/album/rename`, { method:"POST", body: fd });
  const d = await resp.json();
  if(!resp.ok){
    toast(d?.detail || "Не удалось переименовать");
    return;
  }
  currentAlbumName = d.name || name;
  $("topTitle").textContent = currentAlbumName;
  toast("✏️ Готово");
  $("manageModal").classList.remove("show");
  await loadAlbums();
}

async function deleteAlbum(){
  if(!currentPerms.is_owner){
    toast("Только владелец может удалить");
    return;
  }
  const ok = confirm("Удалить альбом навсегда?");
  if(!ok) return;

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);

  const resp = await fetch(`${API}/api/album/delete`, { method:"POST", body: fd });
  const d = await resp.json();
  if(!resp.ok){
    toast(d?.detail || "Не удалось удалить");
    return;
  }
  toast("🗑 Альбом удалён");
  $("manageModal").classList.remove("show");
  currentAlbumCode = "";
  currentAlbumName = "";
  showAlbumsScreen();
  await loadAlbums();
}

async function leaveAlbum(){
  const ok = confirm("Выйти из альбома?");
  if(!ok) return;

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);

  const resp = await fetch(`${API}/api/member/leave`, { method:"POST", body: fd });
  const d = await resp.json();
  if(!resp.ok){
    toast(d?.detail || "Не удалось выйти");
    return;
  }
  toast("🚪 Ты вышел(ла) из альбома");
  $("manageModal").classList.remove("show");
  $("membersModal").classList.remove("show");
  currentAlbumCode = "";
  currentAlbumName = "";
  showAlbumsScreen();
  await loadAlbums();
}

// ===== Members =====
async function openMembers(){
  $("membersModal").classList.add("show");

  if(currentPerms.is_owner){
    $("membersOwnerHint").textContent = "👑 Ты владелец — можешь менять роли и кикать участников.";
    $("membersAddBox").style.display = "block";
    $("leaveBtnInside").classList.add("hidden");
  } else if(currentPerms.is_moderator) {
    $("membersOwnerHint").textContent = "🛠 Ты модератор — можешь кикать участников.";
    $("membersAddBox").style.display = "none";
    $("leaveBtnInside").classList.remove("hidden");
  } else {
    $("membersOwnerHint").textContent = "👤 Ты участник. Можешь выйти из альбома.";
    $("membersAddBox").style.display = "none";
    $("leaveBtnInside").classList.remove("hidden");
  }

  await loadMembers();
}

async function loadMembers(){
  const list = $("membersList");
  list.innerHTML = "<div class='text-center opacity-50 py-4'>Загрузка...</div>";

  try {
    const res = await fetch(`${API}/api/album/members?code=${currentAlbumCode}`);
    const data = await res.json();
    list.innerHTML = "";

    const roleLabels = {
      'owner': '👑 Владелец',
      'moderator': '🛠 Модер',
      'participant': '👤 Участник',
      'viewer': '👁 Наблюдатель'
    };

    data.members.forEach(m => {
      const item = document.createElement("div");
      // Используем стили кнопок как в твоем исходном коде
      item.className = "btn glass rounded-2xl px-4 py-3 flex flex-col gap-2 pointer-events-none";
      
      const label = roleLabels[m.role] || 'Участник';

      item.innerHTML = `
        <div class="flex items-center justify-between w-full">
          <div class="flex flex-col text-left">
            <div class="font-semibold text-sm">${m.username || 'Аноним'}</div>
            <div class="text-[10px] opacity-60 uppercase tracking-tighter">${label}</div>
          </div>
          <div class="flex items-center gap-1 pointer-events-auto">
            ${(currentPerms.is_owner || currentPerms.is_moderator) && m.role !== 'owner' && m.user_id != userId ? 
              `<button onclick="kickMember(${m.user_id})" class="text-red-400 p-2 active:scale-90 transition-transform">❌</button>` : ''}
          </div>
        </div>
        
        ${currentPerms.is_owner && m.role !== 'owner' ? `
          <div class="flex gap-2 mt-1 pointer-events-auto">
            <button onclick="changeRole(${m.user_id}, 'moderator')" class="text-[10px] bg-white/10 px-2 py-1 rounded-lg border border-white/10 active:bg-white/20">Сделать модером</button>
            <button onclick="changeRole(${m.user_id}, 'participant')" class="text-[10px] bg-white/10 px-2 py-1 rounded-lg border border-white/10 active:bg-white/20">Сделать участником</button>
          </div>
        ` : ''}
      `;
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = "<div class='text-center text-red-400'>Ошибка загрузки</div>";
  }
}

function memberCard(m, i){
  const hasProfile = !!(m.username || m.first_name || m.last_name);
  const displayName = hasProfile
    ? ([m.first_name, m.last_name].filter(Boolean).join(" ").trim() || ("@" + (m.username||"")))
    : "Гость";
  const uname = m.username ? "@" + m.username : "—";
  const displayId = hasProfile ? m.user_id : 112;
  const initial = (m.first_name || m.username || "G").toString().charAt(0).toUpperCase();

  const avatar = `
    <div class="relative w-11 h-11 rounded-2xl bg-white/10 overflow-hidden shrink-0">
      <span class="fallback absolute inset-0 flex items-center justify-center font-bold">${escapeHtml(initial)}</span>
      <img src="${API}/api/avatar/${m.user_id}" class="absolute inset-0 w-full h-full object-cover"
           onload="this.parentElement.querySelector('.fallback').style.display='none';"
           onerror="this.style.display='none'; this.parentElement.querySelector('.fallback').style.display='flex';" />
    </div>
  `;

  const controls = currentPerms.is_owner ? `
    <div class="flex flex-col items-end gap-2">
      <div class="flex items-center gap-3">
        <span class="text-[11px] opacity-70">⬆️</span>
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input id="mu_${m.user_id}" type="checkbox" class="sr-only" ${m.can_upload ? "checked" : ""} onchange="updateMemberPermFromUI(${m.user_id})">
          <span class="tg-toggle tg-green"><span class="dot"></span></span>
        </label>

        <span class="text-[11px] opacity-70">🗑</span>
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input id="md_${m.user_id}" type="checkbox" class="sr-only" ${m.can_delete ? "checked" : ""} onchange="updateMemberPermFromUI(${m.user_id})">
          <span class="tg-toggle tg-red"><span class="dot"></span></span>
        </label>
      </div>

      <button class="btn glass px-3 py-2 rounded-2xl text-xs text-red-200"
              onclick="removeMember(${m.user_id})">Удалить</button>
    </div>
  ` : `
    <div class="text-[11px] opacity-80 text-right">
      👀 просмотр${m.can_upload ? " • ⬆️" : ""}${m.can_delete ? " • 🗑" : ""}
    </div>
  `;

  return `
    <div class="glass rounded-2xl p-3 btn flex items-center justify-between gap-3 pop"
         style="animation-delay:${i*10}ms">
      <div class="flex items-center gap-3 min-w-0">
        ${avatar}
        <div class="min-w-0">
          <div class="font-semibold truncate">${escapeHtml(displayName || "Гость")}</div>
          <div class="text-xs opacity-70">${escapeHtml(uname)}</div>
          <div class="text-xs opacity-70">ID: ${escapeHtml(String(displayId))}</div>
        </div>
      </div>
      ${controls}
    </div>
  `;
}

async function loadMembers(){
  const r = await fetch(`${API}/api/members/${currentAlbumCode}?user_id=${userId}`);
  const d = await r.json();
  if(!r.ok){
    toast(d?.detail || "Не удалось получить список");
    return;
  }
  $("membersList").innerHTML = (d || []).map((m,i) => memberCard(m,i)).join("") || `<div class="text-xs opacity-70">Пока никого нет</div>`;
}

window.updateMemberPermFromUI = async function(memberId){
  if(!currentPerms.is_owner){ toast("Только владелец"); return; }

  const canUpload = !!document.getElementById(`mu_${memberId}`)?.checked;
  const canDelete = !!document.getElementById(`md_${memberId}`)?.checked;

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("member_id", String(memberId));
  fd.append("can_upload", canUpload ? "true" : "false");
  fd.append("can_delete", canDelete ? "true" : "false");

  const r = await fetch(`${API}/api/member/update`, { method:"POST", body: fd });
  const d = await r.json();
  if(!r.ok){
    toast(d?.detail || "Не удалось обновить права");
    await loadMembers();
    return;
  }
  toast("✅ Права обновлены");
}

function pickPersonFromMembers(){
  if(!currentPerms.is_owner){ toast("Только владелец"); return; }
  const canUpload = $("canUploadChk").checked;
  const canDelete = $("canDeleteChk").checked;
  const flags = (canUpload ? "1" : "0") + (canDelete ? "1" : "0");
  const deep = `https://t.me/Iventry_Bot?start=pick_${currentAlbumCode}_${flags}`;
  tg.openTelegramLink(deep);
  toast("Открыл бота — нажми «Выбрать человека»");
}

async function addMember(){
  let raw = ($("memberInput").value || "").trim();
  if(!raw){ toast("Введи ID или @username"); return; }

  let memberId = null;

  if(/^\d+$/.test(raw)){
    memberId = Number(raw);
  }

  if(memberId === null){
    let uname = raw;
    if(uname.startsWith("@")) uname = uname.slice(1);
    if(/^[A-Za-z0-9_]{5,32}$/.test(uname)){
      try{
        const rr = await fetch(`${API}/api/resolve?username=${encodeURIComponent(uname)}`);
        const dd = await rr.json();
        if(!rr.ok){
          toast("Не смог найти @username — пусть человек откроет бота, или жми «👤 Добавить человека»");
          return;
        }
        memberId = dd.user_id;
      }catch(_){
        toast("Ошибка резолва @username");
        return;
      }
    }
  }

  if(memberId === null){
    toast("Нужен Telegram ID или @username");
    return;
  }

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("member_id", String(memberId));
  fd.append("can_upload", $("canUploadChk").checked ? "true" : "false");
  fd.append("can_delete", $("canDeleteChk").checked ? "true" : "false");

  const r = await fetch(`${API}/api/member/add`, { method:"POST", body: fd });
  const d = await r.json();
  if(!r.ok){
    toast(d?.detail || "Не удалось добавить");
    return;
  }
  toast("✅ Участник добавлен");
  $("memberInput").value = "";
  await loadMembers();
}

window.removeMember = async function(memberId){
  if(!currentPerms.is_owner){ toast("Только владелец"); return; }
  const ok = confirm("Удалить участника из альбома?");
  if(!ok) return;

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("member_id", String(memberId));

  const r = await fetch(`${API}/api/member/remove`, { method:"POST", body: fd });
  const d = await r.json();
  if(!r.ok){
    toast(d?.detail || "Не удалось удалить");
    return;
  }
  toast("🗑 Участник удалён");
  await loadMembers();
}

// ===== UI binds =====
$("backBtn").onclick = async () => {
  currentAlbumCode = "";
  currentAlbumName = "";
  currentPerms = { is_owner:false, can_upload:false, can_delete:false };
  showAlbumsScreen();
  await loadAlbums();
};

$("galleryBtn").onclick = () => {
  if(!currentPerms.can_upload){ toast("Нет прав на загрузку"); return; }
  galleryPicker();
};

$("cameraBtn").onclick = async () => {
  if(!currentPerms.can_upload){ toast("Нет прав на загрузку"); return; }
  await startCamera();
};

$("shareBtnBottom").onclick = () => {
  if(!currentPerms.is_owner){ toast("Поделиться может только владелец"); return; }
  $("shareModal").classList.add("show");
};

$("shareClose").onclick = () => $("shareModal").classList.remove("show");
$("shareNoLimit").onclick = () => { $("shareMaxUses").value = "0"; toast("Без лимита ✅"); }
$("shareLinkBtn").onclick = async () => { await shareByLink(); }
$("sharePersonBtn").onclick = () => { sharePersonToBot(); }

$("cameraClose").onclick = stopCamera;
$("camFallback").onclick = cameraFallback;
$("camShot").onclick = takeShot;
$("camFlip").onclick = flipCamera;

$("manageClose").onclick = () => $("manageModal").classList.remove("show");
$("membersClose").onclick = () => $("membersModal").classList.remove("show");

$("renameBtn").onclick = renameAlbum;
$("membersBtn").onclick = async () => { $("manageModal").classList.remove("show"); await openMembers(); };
$("deleteAlbumBtn").onclick = deleteAlbum;

$("leaveBtn").onclick = leaveAlbum;
$("leaveBtnInside").onclick = leaveAlbum;

$("pickBtn").onclick = pickPersonFromMembers;
$("memberAddBtn").onclick = addMember;

$("topMenuBtn").onclick = () => openManage();

// fullscreen buttons
$("fullClose").onclick = () => $("fullModal").classList.remove("show");
$("fullModal").onclick = (e) => { if(e.target === $("fullModal")) $("fullModal").classList.remove("show"); };
$("fullDownload").onclick = downloadCurrent;
$("fullDelete").onclick = deleteCurrentFull;
$("fullZoom").onclick = toggleZoom;

// close when tap outside (other modals)
for (const id of ["cameraModal","manageModal","membersModal","shareModal"]){
  $(id).onclick = (e) => { if(e.target === $(id)) $(id).classList.remove("show"); };
}

window.addEventListener("resize", () => {
  if($("fullModal").classList.contains("show")){
    renderFullSlides();
  }
});

attachFullGestures();

showAlbumsScreen();
loadAlbums();