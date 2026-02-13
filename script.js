const tg = window.Telegram.WebApp;
tg.expand();

const API = "https://api-xkrcgy4lto.amvera.io"; // Используем относительный путь для API

// --- НАЧАЛО ФАЙЛА ---
tg.ready();

// ID пользователя из Telegram. Для тестов в браузере используем ID гостя (112)
// Важно: 0 — невалидный ID, многие вещи могут не работать.
const tgUserId = tg.initDataUnsafe?.user?.id || 112;
const userId = tgUserId;

// Показываем баннер для гостей или если не удалось получить ID
if (!userId || userId === 112) {
    const banner = document.getElementById("guestBanner");
    if (banner) banner.classList.remove("hidden");
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
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> t.classList.add("hidden"), 2300);
}

function escapeHtml(s){
  return (s||"").replace(/[&<>"\']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
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
  const list = $("albumsList"); 
  if (!list) return;
  list.innerHTML = "<div class='text-center opacity-50 py-10'>Загрузка...</div>";

  try {
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
            <div class="font-bold text-lg leading-tight">${escapeHtml(a.name)}</div>
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
      const galleryBtn = $("galleryBtn");
      
      // Блокируем кнопки если нельзя
      if (!currentPerms.can_upload) {
        camBtn.style.opacity = "0.3";
        camBtn.style.pointerEvents = "none";
        galleryBtn.style.opacity = "0.3";
        galleryBtn.style.pointerEvents = "none";
      } else {
        camBtn.style.opacity = "1";
        camBtn.style.pointerEvents = "auto";
        galleryBtn.style.opacity = "1";
        galleryBtn.style.pointerEvents = "auto";
      }
      
      // Настройки доступны владельцу или модератору
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
  $("photoGrid").innerHTML = "<div class='text-center opacity-50 py-10'>Загрузка фото...</div>";
  $("permBadge").textContent = "Загрузка…";
  $("uploadHint").textContent = "";

  try {
      const r = await fetch(`${API}/api/photos/${currentAlbumCode}?user_id=${userId}`);
      const d = await r.json();

      if(!r.ok){
        toast(d?.detail || "Ошибка загрузки");
        currentPerms = {role:'viewer', is_owner:false, can_upload:false, can_delete_any:false};
        $("permBadge").textContent = "Нет доступа";
        $("photoGrid").innerHTML = "";
        return;
      }

      currentPerms = d.perms || {role:'viewer', is_owner:false, can_upload:false, can_delete_any:false};
      const badge = currentPerms.is_owner
        ? "👑 Владелец"
        : (currentPerms.can_upload ? "✅ Участник" : "👀 Просмотр");
      $("permBadge").textContent = badge;

      $("uploadHint").textContent = currentPerms.can_upload
        ? "Можно добавлять фото. Удаление: владелец/модератор/автор фото."
        : "Нет прав на загрузку. Попроси владельца выдать доступ.";

      const items = d.items || [];
      albumPhotos = items.map(p => ({ url: p.url, uploaded_by: p.uploaded_by || 0 }));

      if (items.length === 0) {
          $("photoGrid").innerHTML = "<div class='text-center opacity-30 py-10'>В альбоме пока нет фото</div>";
          return;
      }

      const animateTiles = items.length <= 60;
      $("photoGrid").innerHTML = items.map((p,i) => `
        <div class="photo-tile ${animateTiles ? "pop" : ""}"
             style="${animateTiles ? `animation-delay:${i*12}ms` : ""}"
             onclick="openFullAtUrl('${p.url}')">
          <img src="${p.url}" loading="lazy" decoding="async" />
        </div>
      `).join("");
  } catch(e) {
      $("photoGrid").innerHTML = "<div class='text-center text-red-400 py-10'>Ошибка загрузки фото</div>";
  }
}

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function canDeletePhoto(photo){
  return !!(currentPerms.is_owner || currentPerms.can_delete_any || (photo?.uploaded_by && photo.uploaded_by === userId));
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

  if(dx <= -threshold && fullIndex < albumPhotos.length - 1){
    fullIndex++;
  }else if(dx >= threshold && fullIndex > 0){
    fullIndex--;
  }
  renderFullSlides();
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

  try {
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
  } catch(e) {
      toast("Ошибка при удалении");
  }
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

  try {
    const r = await fetch(`${API}/api/upload`, { method:"POST", body: fd });
    const d = await r.json();
    if(!r.ok){
        toast(d?.detail || "Ошибка загрузки");
        return;
    }
    toast("✅ Загружено");
    await loadPhotos();
  } catch(e) {
      toast("Ошибка сети при загрузке");
  }
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

  try {
    const r = await fetch(`${API}/api/invite/create`, { method:"POST", body: fd });
    const d = await r.json();
    if(!r.ok){
        toast(d?.detail || "Не удалось создать ссылку");
        return null;
    }
    return d.link;
  } catch(e) {
      toast("Ошибка сети");
      return null;
  }
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

  try {
    const res = await fetch(`${API}/api/member/set_role`, { method: "POST", body: fd });
    if (res.ok) {
        toast("Роль изменена ✅");
        await loadMembers();
    } else {
        toast("Ошибка при смене роли");
    }
  } catch(e) {
      toast("Ошибка сети");
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

  try {
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
  } catch(e) {
      toast("Ошибка сети");
  }
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

  try {
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
  } catch(e) {
      toast("Ошибка сети");
  }
}

async function leaveAlbum(){
  const ok = confirm("Выйти из альбома?");
  if(!ok) return;

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);

  try {
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
  } catch(e) {
      toast("Ошибка сети");
  }
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
  if (!list) return;
  list.innerHTML = "<div class='text-center opacity-50 py-4'>Загрузка...</div>";

  try {
    const res = await fetch(`${API}/api/album/members?album_code=${currentAlbumCode}&user_id=${userId}`);
    const data = await res.json();
    list.innerHTML = "";

    const roleLabels = {
      'owner': '👑 Владелец',
      'moderator': '🛠 Модер',
      'participant': '👤 Участник',
      'viewer': '👁 Наблюдатель'
    };

    if(!data.members || data.members.length === 0) {
      list.innerHTML = "<div class='text-center opacity-30'>Пока никого нет</div>";
      return;
    }

    data.members.forEach(m => {
      const item = document.createElement("div");
      item.className = "btn glass rounded-2xl px-4 py-3 flex flex-col gap-2 pointer-events-none";
      
      const label = roleLabels[m.role] || 'Участник';
      const initial = (m.first_name || m.username || "U").toString().charAt(0).toUpperCase();

      item.innerHTML = `
        <div class="flex items-center justify-between w-full">
          <div class="flex items-center gap-3 text-left">
             <div class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center font-bold text-lg">${initial}</div>
             <div class="flex flex-col">
                <div class="font-semibold text-sm">${escapeHtml(m.first_name || (m.username ? "@"+m.username : "Гость"))}</div>
                <div class="text-[10px] opacity-60 uppercase tracking-tighter">${label}</div>
             </div>
          </div>
          <div class="flex items-center gap-1 pointer-events-auto">
            ${(currentPerms.is_owner || currentPerms.is_moderator) && m.role !== 'owner' && m.user_id != userId ? 
              `<button onclick="kickMember(${m.user_id})" class="text-red-400 p-2 active:scale-90 transition-transform">❌</button>` : ''}
          </div>
        </div>
        
        ${currentPerms.is_owner && m.role !== 'owner' ? `
          <div class="flex gap-2 mt-1 pointer-events-auto">
            <button onclick="changeRole(${m.user_id}, 'moderator')" class="text-[10px] bg-white/10 px-2 py-1 rounded-lg border border-white/10 active:bg-white/20">Модератор</button>
            <button onclick="changeRole(${m.user_id}, 'participant')" class="text-[10px] bg-white/10 px-2 py-1 rounded-lg border border-white/10 active:bg-white/20">Участник</button>
          </div>
        ` : ''}
      `;
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = "<div class='text-center text-red-400'>Ошибка загрузки</div>";
  }
}

window.kickMember = async function(memberId){
  if(!confirm("Удалить участника из альбома?")) return;
  // Здесь должен быть вызов API для удаления, если он есть
  toast("Удаление временно недоступно через UI");
}

// ===== UI binds =====
if ($("backBtn")) {
    $("backBtn").onclick = async () => {
      currentAlbumCode = "";
      currentAlbumName = "";
      currentPerms = { role:'viewer', is_owner:false, can_upload:false, can_delete_any:false };
      showAlbumsScreen();
      await loadAlbums();
    };
}

if ($("galleryBtn")) {
    $("galleryBtn").onclick = () => {
      if(!currentPerms.can_upload){ toast("Нет прав на загрузку"); return; }
      galleryPicker();
    };
}

if ($("cameraBtn")) {
    $("cameraBtn").onclick = async () => {
      if(!currentPerms.can_upload){ toast("Нет прав на загрузку"); return; }
      await startCamera();
    };
}

if ($("shareBtnBottom")) {
    $("shareBtnBottom").onclick = () => {
      if(!currentPerms.is_owner){ toast("Поделиться может только владелец"); return; }
      $("shareModal").classList.add("show");
    };
}

if ($("shareClose")) $("shareClose").onclick = () => $("shareModal").classList.remove("show");
if ($("shareNoLimit")) $("shareNoLimit").onclick = () => { $("shareMaxUses").value = "0"; toast("Без лимита ✅"); }
if ($("shareLinkBtn")) $("shareLinkBtn").onclick = async () => { await shareByLink(); }
if ($("sharePersonBtn")) $("sharePersonBtn").onclick = () => { sharePersonToBot(); }

if ($("cameraClose")) $("cameraClose").onclick = stopCamera;
if ($("camFallback")) $("camFallback").onclick = cameraFallback;
if ($("camShot")) $("camShot").onclick = takeShot;
if ($("camFlip")) $("camFlip").onclick = flipCamera;

if ($("manageClose")) $("manageClose").onclick = () => $("manageModal").classList.remove("show");
if ($("membersClose")) $("membersClose").onclick = () => $("membersModal").classList.remove("show");

if ($("renameBtn")) $("renameBtn").onclick = renameAlbum;
if ($("membersBtn")) $("membersBtn").onclick = async () => { $("manageModal").classList.remove("show"); await openMembers(); };
if ($("deleteAlbumBtn")) $("deleteAlbumBtn").onclick = deleteAlbum;

if ($("leaveBtn")) $("leaveBtn").onclick = leaveAlbum;
if ($("leaveBtnInside")) $("leaveBtnInside").onclick = leaveAlbum;

if ($("topMenuBtn")) $("topMenuBtn").onclick = () => openManage();

// fullscreen buttons
if ($("fullClose")) $("fullClose").onclick = () => $("fullModal").classList.remove("show");
if ($("fullModal")) $("fullModal").onclick = (e) => { if(e.target === $("fullModal")) $("fullModal").classList.remove("show"); };
if ($("fullDownload")) $("fullDownload").onclick = downloadCurrent;
if ($("fullDelete")) $("fullDelete").onclick = deleteCurrentFull;
if ($("fullZoom")) $("fullZoom").onclick = toggleZoom;

// close when tap outside (other modals)
for (const id of ["cameraModal","manageModal","membersModal","shareModal"]){
  const el = $(id);
  if (el) {
    el.onclick = (e) => { if(e.target === el) el.classList.remove("show"); };
  }
}

window.addEventListener("resize", () => {
  if($("fullModal") && $("fullModal").classList.contains("show")){
    renderFullSlides();
  }
});

attachFullGestures();

showAlbumsScreen();
loadAlbums();
