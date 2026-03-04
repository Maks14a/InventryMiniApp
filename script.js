// Iventry Mini App — script.js (clean, with DEV mode)
// DEV mode is enabled automatically when opened outside Telegram (userId == 112) or with ?dev=1

const tg = window.Telegram?.WebApp || {
  initDataUnsafe: {},
  ready() {},
  expand() {},
  openLink: (url) => window.open(url, "_blank"),
  openTelegramLink: (url) => window.open(url, "_blank"),
};

try { tg.expand?.(); } catch (_) {}
try { tg.ready?.(); } catch (_) {}

const API = "https://eventry-api-vozmak.amvera.io";

// ID пользователя из Telegram. Для тестов в браузере используем ID гостя (112)
const userId = Number(tg.initDataUnsafe?.user?.id) || 112;

// DEV: локальная верстка без API/бота
const DEV = (userId === 112) || (new URLSearchParams(location.search).get("dev") === "1");

// Показываем баннер для гостей / dev-режима
if (DEV) {
  const banner = document.getElementById("guestBanner");
  if (banner) banner.classList.remove("hidden");
}

let currentAlbumCode = "";
let currentAlbumName = "";
let currentPerms = {
  role: "viewer",
  is_owner: false,
  is_moderator: false,
  can_upload: false,
  can_delete_any: false,
  is_opened: false,
};

let camStream = null;
let cameraFacing = "environment";
let previewBlob = null;

// album photos cache for fullscreen swipe
let albumPhotos = []; // [{url, uploaded_by}]
let fullIndex = 0;

// swipe/gesture state
let dragging = false;
let startX = 0;
let startY = 0;
let dx = 0;
let lastTapAt = 0;

let pinching = false;
let pinchStartDist = 0;


const $ = (id) => document.getElementById(id);

function toast(msg) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => t.classList.add("hidden"), 2300);
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"\']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[m]));
}

async function openCamera(){

  const modal = $("cameraModal")
  modal.classList.add("show")

  try{

    camStream = await navigator.mediaDevices.getUserMedia({
    video:{
    facingMode: cameraFacing,
    width:{ideal:1920},
    height:{ideal:1080}
  }
  })

  $("camVideo").srcObject = camStream

  }catch(e){
  toast("Камера не доступна")
  }

}

function roleIcon(role){
  if(role === "owner"){
  return `<svg width="18" height="18" viewBox="0 0 24 24">
  <path fill="white"
  d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8Z"/>
  </svg>`
  }

  if(role === "participant"){
  return `<svg width="18" height="18" viewBox="0 0 24 24">
  <path fill="white"
  d="M12 12C14.2 12 16 10.2 16 8C16 5.8 14.2 4 12 4C9.8 4 8 5.8 8 8C8 10.2 9.8 12 12 12ZM12 14C7.6 14 4 16.2 4 19V20H20V19C20 16.2 16.4 14 12 14Z"/>
  </svg>`
  }

  return `<svg width="18" height="18" viewBox="0 0 24 24">
  <path fill="white"
  d="M12 4A8 8 0 1 0 12 20A8 8 0 1 0 12 4Z"/>
  </svg>`
}

function showAlbumsScreen() {
  $("screenAlbums")?.classList.remove("hidden");
  $("screenAlbum")?.classList.add("hidden");
  $("topTitle").textContent = "Альбомы";
  $("topMenuBtn").onclick = () => toast("Открой альбом, чтобы управлять 🙂");
  $("topMenuBtn").classList.add("hidden");
}

function showAlbumScreen() {
  $("screenAlbums")?.classList.add("hidden");
  $("screenAlbum")?.classList.remove("hidden");
  $("topTitle").textContent = currentAlbumName || "Альбом";
  $("topMenuBtn").onclick = () => openManage();
}

/* ==========================
   DEV MOCK DATA (albums/photos/members)
   ========================== */

const DEV_ALBUMS_KEY = "iventry_dev_albums_v1";
const DEV_MEMBERS = {};          // album_code -> members[]
const DEV_RUNTIME_PHOTOS = {};   // album_code -> photos[]

function devDefaultAlbums() {
  return [
    { code: "demo_a", name: "Демо: День рождения", role: "owner" },
    { code: "demo_b", name: "Демо: Концерт", role: "participant" },
    { code: "demo_c", name: "Демо: Съёмка", role: "viewer" },
  ];
}

function devLoadAlbums() {
  try {
    const raw = localStorage.getItem(DEV_ALBUMS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}
  const seed = devDefaultAlbums();
  localStorage.setItem(DEV_ALBUMS_KEY, JSON.stringify(seed));
  return seed;
}

function devSaveAlbums(arr) {
  localStorage.setItem(DEV_ALBUMS_KEY, JSON.stringify(arr));
}

function devPermsByRole(role) {
  if (role === "owner") {
    return { role: "owner", is_owner: true, is_moderator: true, can_upload: true, can_delete_any: true, is_opened: true };
  }
  if (role === "participant") {
    return { role: "participant", is_owner: false, is_moderator: false, can_upload: true, can_delete_any: false, is_opened: true };
  }
  return { role: "viewer", is_owner: false, is_moderator: false, can_upload: false, can_delete_any: false, is_opened: true };
}

function devSvg(label) {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#141416"/>
        <stop offset="1" stop-color="#2b2b30"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="50%" font-size="66" fill="rgba(255,255,255,0.65)"
          font-family="system-ui, -apple-system, Segoe UI, Roboto"
          text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.trim());
}

function devPhotosFor(code) {
  // 9 плиток, чтобы удобно править сетку UI
  const items = Array.from({ length: 9 }, (_, i) => ({
    url: devSvg(`${code.toUpperCase()} • ${i + 1}`),
    uploaded_by: userId,
  }));
  return items;
}

function devGetPhotos(code) {
  if (!DEV_RUNTIME_PHOTOS[code]) DEV_RUNTIME_PHOTOS[code] = devPhotosFor(code);
  return DEV_RUNTIME_PHOTOS[code];
}

function devSeedMembers(code) {
  // немного реалистичный набор
  const base = [
    { user_id: userId, role: "owner", first_name: "Вы", username: "" },
    { user_id: 2001, role: "participant", first_name: "Аня", username: "anya" },
    { user_id: 2002, role: "viewer", first_name: "Гость", username: "" },
  ];
  DEV_MEMBERS[code] = base;
  return base;
}

function devGetMembers(code) {
  if (!DEV_MEMBERS[code]) return devSeedMembers(code);
  return DEV_MEMBERS[code];
}

/* ==========================
   Albums / Photos
   ========================== */

async function loadAlbums() {
  const list = $("albumsList");
  if (!list) return;
  list.innerHTML = "<div class='text-center opacity-50 py-10'>Загрузка...</div>";

  // DEV: без API
  if (DEV) {
    const data = devLoadAlbums();
    list.innerHTML = "";

    if (!data || data.length === 0) {
      list.innerHTML = "<div class='text-center opacity-30 py-10'>Альбомов пока нет</div>";
      return;
    }

    data.forEach((a) => {
      const card = document.createElement("div");
      card.className = "btn glass rounded-3xl p-5 flex items-center justify-between mb-3 w-full";
      card.onclick = () => openAlbum(a.code, a.name);
      card.innerHTML = `
        <div class="flex items-center gap-4 text-left">
        <div class="album-cover">
        ${a.cover_url
          ? `<img src="${a.cover_url}">`
          : `<span>${escapeHtml(a.name[0])}</span>`
        }
        </div>
          <div>
            <div class="font-bold text-lg leading-tight">${escapeHtml(a.name)}</div>
            <div class="text-xs opacity-50 uppercase tracking-widest">
              ${a.role === "owner" ? "Создатель" : (a.role === "participant" ? "Участник" : "Просмотр")}
            </div>
          </div>
        </div>
        <div class="opacity-30">→</div>
      `;
      list.appendChild(card);
    });

    return;
  }

  // PROD: API
  try {
    const res = await fetch(`${API}/api/albums/${userId}`);
    const data = await res.json();
    list.innerHTML = "";

    if (!data || data.length === 0) {
      list.innerHTML = "<div class='text-center opacity-30 py-10'>Альбомов пока нет</div>";
      return;
    }

    data.forEach((a) => {
      const card = document.createElement("div");
      card.className = "btn glass rounded-3xl p-5 flex items-center justify-between mb-3 w-full";
      card.onclick = () => openAlbum(a.code, a.name);
      card.innerHTML = `
        <div class="flex items-center gap-4 text-left">
          <div class="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center text-2xl shadow-inner">🖼</div>
          <div>
            <div class="font-bold text-lg leading-tight">${escapeHtml(a.name)}</div>
            <div class="text-xs opacity-50 uppercase tracking-widest">${a.role === "owner" ? "Создатель" : "Участник"}</div>
          </div>
        </div>
        <div class="opacity-30">→</div>
      `;
      list.appendChild(card);
    });
  } catch (e) {
    list.innerHTML = "<div class='text-center text-red-400 py-10'>Ошибка связи</div>";
  }
}

window.openAlbum = async function openAlbum(code, name) {
  currentAlbumCode = code;
  currentAlbumName = name;
  showAlbumScreen();
  $("topTitle").textContent = name;

  // DEV: без API
  if (DEV) {
    const a = devLoadAlbums().find((x) => x.code === code);
    currentPerms = devPermsByRole(a?.role || "owner");

    const camBtn = $("cameraBtn");
    

    // upload actions
    if (camBtn) {
      camBtn.style.opacity = currentPerms.can_upload ? "1" : "0.3";
      camBtn.style.pointerEvents = currentPerms.can_upload ? "auto" : "none";
    }

    $("topMenuBtn").classList.toggle("hidden", !(currentPerms.is_owner || currentPerms.is_moderator));

    await loadPhotos();
    return;
  }

  // PROD: получаем perms
  try {
    const res = await fetch(`${API}/api/album/info/${code}/${userId}`);
    const data = await res.json();
    if (data.perms) {
      currentPerms = data.perms;

      const camBtn = $("cameraBtn");
      

      // Блокируем кнопки загрузки если нельзя
      if (camBtn) {
        camBtn.style.opacity = currentPerms.can_upload ? "1" : "0.3";
        camBtn.style.pointerEvents = currentPerms.can_upload ? "auto" : "none";
      }
      if (galleryBtn) {
        galleryBtn.style.opacity = currentPerms.can_upload ? "1" : "0.3";
        galleryBtn.style.pointerEvents = currentPerms.can_upload ? "auto" : "none";
      }

      // Настройки доступны владельцу или модератору
      $("topMenuBtn").classList.toggle("hidden", !(currentPerms.is_owner || currentPerms.is_moderator));
    }
  } catch (e) {
    console.error(e);
  }

  await loadPhotos();
};

async function loadPhotos() {
  $("photoGrid").innerHTML = "<div class='text-center opacity-50 py-10'>Загрузка фото...</div>";
  $("permBadge").textContent = "Загрузка…";
  $("uploadHint").textContent = "";

  // DEV: без API
  if (DEV) {
    const items = devGetPhotos(currentAlbumCode);

    const badge = currentPerms.is_owner ? "Владелец" : (currentPerms.can_upload ? "Участник" : "Просмотр");
    $("permBadge").textContent = badge;

    $("uploadHint").textContent = currentPerms.can_upload
      ? "Можно добавлять фото (локально)."
      : "Только просмотр (локально).";

    albumPhotos = items.map((p) => ({ url: p.url, uploaded_by: p.uploaded_by || 0 }));

    if (items.length === 0) {
      $("photoGrid").innerHTML = "<div class='text-center opacity-30 py-10'>В альбоме пока нет фото</div>";
      return;
    }

    const animateTiles = items.length <= 60;
    $("photoGrid").innerHTML = items.map((p, i) => `
      <div class="photo-tile ${animateTiles ? "pop" : ""}"
           style="${animateTiles ? `animation-delay:${i * 12}ms` : ""}"
           onclick="openFullAtUrl('${p.url}')">
        <img src="${p.url}" loading="lazy" decoding="async" />
      </div>
    `).join("");

    return;
  }

  // PROD: API
  try {
    const r = await fetch(`${API}/api/photos/${currentAlbumCode}?user_id=${userId}`);
    const d = await r.json();

    if (!r.ok) {
      toast(d?.detail || "Ошибка загрузки");
      currentPerms = { role: "viewer", is_owner: false, can_upload: false, can_delete_any: false };
      $("permBadge").textContent = "Нет доступа";
      $("photoGrid").innerHTML = "";
      return;
    }

    if (d.perms) {
      currentPerms = d.perms;
    }

    const badge = currentPerms.is_owner
      ? "Владелец"
      : (currentPerms.can_upload ? "Участник" : "Просмотр");
    $("permBadge").textContent = badge;

    $("uploadHint").textContent = currentPerms.can_upload
      ? "Можно добавлять фото. Удаление: владелец/модератор/автор фото."
      : "Нет прав на загрузку. Попроси владельца выдать доступ.";

    const items = d.photos || d.items || [];
    // alert("photos loaded: " + items.length)

    albumPhotos = items.map((p) => ({
      url: p.url,
      uploaded_by: p.uploaded_by || 0
    }));

    const uploadedByUser = albumPhotos.filter(p => p.uploaded_by === userId).length;

    let remaining = "∞";

    if (currentPerms.max_photos_per_user) {
      remaining = currentPerms.max_photos_per_user - uploadedByUser;
    }

    $("uploadHint").textContent = `Осталось фото: ${remaining}`;

    if (items.length === 0) {
      $("photoGrid").innerHTML = "<div class='text-center opacity-30 py-10'>В альбоме пока нет фото</div>";
      return;
    }

    const animateTiles = items.length <= 60;
    $("photoGrid").innerHTML = items.map((p, i) => `
      <div class="photo-tile ${animateTiles ? "pop" : ""}"
           style="${animateTiles ? `animation-delay:${i * 12}ms` : ""}"
           onclick="openFullAtUrl('${p.url}')">
        <img src="${p.url}" loading="lazy" decoding="async" />
      </div>
    `).join("");
  } catch (e) {
    $("photoGrid").innerHTML = "<div class='text-center text-red-400 py-10'>Ошибка загрузки фото</div>";
  }
}

/* ==========================
   Fullscreen viewer (swipe/zoom)
   ========================== */

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function canDeletePhoto(photo) {
  return !!(currentPerms.is_owner || currentPerms.can_delete_any || (photo?.uploaded_by && photo.uploaded_by === userId));
}

function getViewerRect() {
  const v = $("fullViewer");
  return v ? v.getBoundingClientRect() : { width: 1, height: 1, left: 0, top: 0 };
}

function getCurrentImgEl() {
  const slides = $("fullTrack")?.children || [];
  for (const el of slides) {
    if (el.classList?.contains("active")) return el.querySelector("img");
  }
  return null;
}

function renderFullSlides() {

  const track = $("fullTrack");
  if (!track) return;

  track.innerHTML = "";

  albumPhotos.forEach((p, i) => {

  const slide = document.createElement("div");
  slide.className = "full-slide";

  slide.innerHTML = `<img src="${p.url}" draggable="false">`;

  track.appendChild(slide);

  });

  track.style.transition = "none";
  track.style.transform = `translateX(-${fullIndex * window.innerWidth}px)`;

  const del = $("fullDelete");
  const can = canDeletePhoto(albumPhotos[fullIndex]);

  if (del) del.classList.toggle("hidden", !can);

}

function openFullAt(index) {
  fullIndex = clamp(index, 0, albumPhotos.length - 1);
  $("fullModal").classList.add("show");
  renderFullSlides();
}

window.openFullAtUrl = function openFullAtUrl(url) {
  const idx = albumPhotos.findIndex((p) => p.url === url);
  openFullAt(idx >= 0 ? idx : 0);
};

function distance(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function onTouchStart(e) {
  if (!$("fullModal")?.classList.contains("show")) return;
  const now = Date.now();

  if (e.touches && e.touches.length === 2) {
    pinching = true;
    pinchStartDist = distance(e.touches[0], e.touches[1]);
    return;
  }

  pinching = false;
  dragging = true;
  const t = e.touches ? e.touches[0] : e;
  startX = t.clientX;
  startY = t.clientY;
  dx = 0;
}

function onTouchMove(e) {
  if (!$("fullModal")?.classList.contains("show")) return;

  if (pinching && e.touches && e.touches.length === 2) {
    const dist = distance(e.touches[0], e.touches[1]);
    const factor = dist / (pinchStartDist || dist);
    e.preventDefault();
    return;
  }

  if (!dragging) return;
  const t = e.touches ? e.touches[0] : e;
  const mx = t.clientX;
  const my = t.clientY;

  const ddx = mx - startX;
  const ddy = my - startY;


  dx = ddx;
  const track = $("fullTrack");
  const vw = window.innerWidth;
  if (!track) return;

  // move all slides with dx
  Array.from(track.children).forEach((slide, i) => {
    track.style.transform = `translateX(${-(fullIndex * window.innerWidth) + dx}px)`
  });
  e.preventDefault();
}

function onTouchEnd() {
  if (!$("fullModal")?.classList.contains("show")) return;
  if (pinching) { pinching = false; return; }
  if (!dragging) return;
  dragging = false;


  const vw = getViewerRect().width;
  if (Math.abs(dx) > vw * 0.18) {
    if (dx < 0 && fullIndex < albumPhotos.length - 1) fullIndex++;
    if (dx > 0 && fullIndex > 0) fullIndex--;
  }
  const track = $("fullTrack")
  track.style.transition = "transform .25s ease"
  track.style.transform = `translateX(-${fullIndex * window.innerWidth}px)`
  renderFullSlides();
}

function attachFullGestures() {
  const viewer = $("fullViewer");
  if (!viewer) return;

  viewer.addEventListener("touchstart", onTouchStart, { passive: false });
  viewer.addEventListener("touchmove", onTouchMove, { passive: false });
  viewer.addEventListener("touchend", onTouchEnd, { passive: true });

  // mouse drag (desktop)
  viewer.addEventListener("mousedown", (e) => onTouchStart(e));
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    onTouchMove(e);
  });
  window.addEventListener("mouseup", () => onTouchEnd());
}

function downloadCurrent(){
  const photo = albumPhotos[fullIndex]

  if(!photo?.url){
  toast("Фото не найдено")
  return
  }

  tg.openTelegramLink(
  `https://t.me/Iventry_Bot?start=dl_${encodeURIComponent(photo.url)}`
  )
}

async function deleteCurrentFull() {
  const photo = albumPhotos[fullIndex];
  if (!photo?.url) return;

  if (!canDeletePhoto(photo)) {
    toast("Нет прав на удаление");
    return;
  }

  const ok = confirm("Удалить это фото?");
  if (!ok) return;

  // DEV: без API
  if (DEV) {
    const arr = devGetPhotos(currentAlbumCode);
    const idx = arr.findIndex((p) => p.url === photo.url);
    if (idx >= 0) {
      const removed = arr.splice(idx, 1)[0];
      // если это objectURL — освободим
      if (removed?.url?.startsWith("blob:")) {
        try { URL.revokeObjectURL(removed.url); } catch (_) {}
      }
    }
    toast("🗑 Удалено (локально)");
    await loadPhotos();
    if (albumPhotos.length === 0) {
      $("fullModal").classList.remove("show");
      return;
    }
    fullIndex = clamp(fullIndex, 0, albumPhotos.length - 1);
    renderFullSlides();
    return;
  }

  // PROD: API
  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("file_url", photo.url);

  try {
    const r = await fetch(`${API}/api/photo/delete`, { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) {
      toast(d?.detail || "Не удалось удалить");
      return;
    }

    toast("🗑 Удалено");
    await loadPhotos();
    if (albumPhotos.length === 0) {
      $("fullModal").classList.remove("show");
      return;
    }
    fullIndex = clamp(fullIndex, 0, albumPhotos.length - 1);
    renderFullSlides();
  } catch (e) {
    toast("Ошибка при удалении");
  }
}

/* ==========================
   Upload / Camera
   ========================== */

function galleryPicker() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.onchange = async () => {
    if (!inp.files || !inp.files[0]) return;
    await uploadFile(inp.files[0]);
  };
  inp.click();
}

async function uploadFile(file) {
  if (!currentPerms.can_upload) {
    toast("Нет прав на загрузку");
    return;
  }

  // DEV: добавляем фото локально
  if (DEV) {
    const url = URL.createObjectURL(file);
    const arr = devGetPhotos(currentAlbumCode);
    arr.unshift({ url, uploaded_by: userId });
    toast("✅ Загружено (локально)");
    await loadPhotos();
    return;
  }

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("file", file);

  try {
    const r = await fetch(`${API}/api/upload`, { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) {
      toast(d?.detail || "Ошибка загрузки");
      return;
    }
    toast("✅ Загружено");
    await loadPhotos();
  } catch (e) {
    toast("Ошибка сети при загрузке");
  }
}

async function startCamera() {
  $("cameraModal").classList.add("show");

  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }

  try {
    const v = $("camVideo");
    v.muted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.autoplay = true;

    const constraintsA = { video: { facingMode: cameraFacing }, audio: false };
    const constraintsB = { video: { facingMode: { ideal: cameraFacing } }, audio: false };

    try {
      camStream = await navigator.mediaDevices.getUserMedia(constraintsA);
    } catch (_) {
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
  } catch (e) {
    console.log(e);
    toast("Камера недоступна — жми «Файл»");
  }
}

function stopCamera() {
  $("cameraModal").classList.remove("show");
  const v = $("camVideo");
  try { v.pause(); } catch (_) {}
  v.srcObject = null;
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }
}

async function flipCamera() {
  cameraFacing = (cameraFacing === "environment") ? "user" : "environment";
  await startCamera();
}

async function takeShot() {
  try {

    const v = $("camVideo");
    if (!v || !v.videoWidth) {
      toast("Нет видео — жми «Файл»");
      return;
    }

    const canvas = $("camCanvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;

    const ctx = canvas.getContext("2d");

    if (cameraFacing === "user") {
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } else {
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    }

  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
  if (!blob) {
    toast("Не удалось сделать фото");
    return;
  }

  previewBlob = blob;

  const url = URL.createObjectURL(blob);
  $("previewImg").src = url;

  $("camPreview").classList.remove("hidden");

  } catch (e) {
    console.log(e);
    toast("Ошибка камеры");
  }
}

function cameraFallback() {
  stopCamera();
  galleryPicker();
}

/* ==========================
   Manage / Share
   ========================== */

function openManage() {
  if (!currentAlbumCode) return;

  $("renameBtn").style.display = currentPerms.is_owner ? "block" : "none";
  $("deleteAlbumBtn").style.display = currentPerms.is_owner ? "block" : "none";
  $("leaveBtn").style.display = currentPerms.is_owner ? "none" : "block";

  $("manageModal").classList.add("show");
}

function getShareRights() {
  const can_upload = $("shareCanUpload").checked;
  const can_delete = $("shareCanDelete").checked;
  const flags = (can_upload ? "1" : "0") + (can_delete ? "1" : "0");
  return { can_upload, can_delete, flags };
}

function getShareMaxUses() {
  const raw = ($("shareMaxUses").value || "").trim();
  let n = parseInt(raw, 10);
  if (Number.isNaN(n)) n = 20;
  if (n < 0) n = 20;
  if (n > 10000) n = 10000;
  return n;
}

async function createInviteLink(canUpload, canDelete, maxUses) {
  // DEV: фейковая ссылка (чтобы UI жил без API)
  if (DEV) {
    const flags = (canUpload ? "1" : "0") + (canDelete ? "1" : "0");
    return `https://t.me/Iventry_Bot?start=join_${currentAlbumCode}_${flags}_${maxUses}`;
  }

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("can_upload", canUpload ? "true" : "false");
  fd.append("can_delete", canDelete ? "true" : "false");
  fd.append("max_uses", String(maxUses));
  fd.append("ttl_hours", "168");

  try {
    const r = await fetch(`${API}/api/invite/create`, { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) {
      toast(d?.detail || "Не удалось создать ссылку");
      return null;
    }
    return d.link;
  } catch (e) {
    toast("Ошибка сети");
    return null;
  }
}

async function shareByLink() {
  if (!currentPerms.is_owner) {
    toast("Только владелец может делиться");
    return;
  }
  const rights = getShareRights();
  const maxUses = getShareMaxUses();

  const link = await createInviteLink(rights.can_upload, rights.can_delete, maxUses);
  if (!link) return;

  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Зайди в мой альбом 👇")}`;
  tg.openTelegramLink?.(shareUrl);
  toast("Выбери чат и отправь ссылку");
}

function sharePersonToBot() {
  if (!currentPerms.is_owner) {
    toast("Только владелец может добавлять людей");
    return;
  }
  const rights = getShareRights();
  const deep = `https://t.me/Iventry_Bot?start=pick_${currentAlbumCode}_${rights.flags}`;
  tg.openTelegramLink?.(deep);
  toast("Открыл бота — нажми «Выбрать человека»");
}

async function renameAlbum() {
  if (!currentPerms.is_owner) {
    toast("Только владелец может переименовать");
    return;
  }
  const newName = prompt("Новое название альбома:", currentAlbumName || "");
  if (newName === null) return;

  const name = (newName || "").trim();
  if (!name) { toast("Название пустое"); return; }

  // DEV
  if (DEV) {
    const albums = devLoadAlbums();
    const idx = albums.findIndex((a) => a.code === currentAlbumCode);
    if (idx >= 0) {
      albums[idx].name = name;
      devSaveAlbums(albums);
    }
    currentAlbumName = name;
    $("topTitle").textContent = currentAlbumName;
    toast("✏️ Готово (локально)");
    $("manageModal").classList.remove("show");
    await loadAlbums();
    return;
  }

  // PROD
  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("new_name", name);

  try {
    const resp = await fetch(`${API}/api/album/rename`, { method: "POST", body: fd });
    const d = await resp.json();
    if (!resp.ok) {
      toast(d?.detail || "Не удалось переименовать");
      return;
    }
    currentAlbumName = d.name || name;
    $("topTitle").textContent = currentAlbumName;
    toast("✏️ Готово");
    $("manageModal").classList.remove("show");
    await loadAlbums();
  } catch (e) {
    toast("Ошибка сети");
  }
}

async function deleteAlbum() {
  if (!currentPerms.is_owner) {
    toast("Только владелец может удалить");
    return;
  }
  const ok = confirm("Удалить альбом навсегда?");
  if (!ok) return;

  // DEV
  if (DEV) {
    const albums = devLoadAlbums().filter((a) => a.code !== currentAlbumCode);
    devSaveAlbums(albums);
    delete DEV_RUNTIME_PHOTOS[currentAlbumCode];
    delete DEV_MEMBERS[currentAlbumCode];

    toast("🗑 Альбом удалён (локально)");
    $("manageModal").classList.remove("show");
    currentAlbumCode = "";
    currentAlbumName = "";
    showAlbumsScreen();
    await loadAlbums();
    return;
  }

  // PROD
  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);

  try {
    const resp = await fetch(`${API}/api/album/delete`, { method: "POST", body: fd });
    const d = await resp.json();
    if (!resp.ok) {
      toast(d?.detail || "Не удалось удалить");
      return;
    }
    toast("🗑 Альбом удалён");
    $("manageModal").classList.remove("show");
    currentAlbumCode = "";
    currentAlbumName = "";
    showAlbumsScreen();
    await loadAlbums();
  } catch (e) {
    toast("Ошибка сети");
  }
}

async function leaveAlbum() {
  if (currentPerms.is_owner) {
    toast("Владелец не может выйти из своего альбома");
    return;
  }
  const ok = confirm("Выйти из альбома?");
  if (!ok) return;

  // DEV: просто убираем альбом из списка
  if (DEV) {
    const albums = devLoadAlbums().filter((a) => a.code !== currentAlbumCode);
    devSaveAlbums(albums);
    toast("🚪 Ты вышел(ла) (локально)");
    $("manageModal").classList.remove("show");
    $("membersModal").classList.remove("show");
    currentAlbumCode = "";
    currentAlbumName = "";
    showAlbumsScreen();
    await loadAlbums();
    return;
  }

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);

  try {
    const resp = await fetch(`${API}/api/member/leave`, { method: "POST", body: fd });
    const d = await resp.json();
    if (!resp.ok) {
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
  } catch (e) {
    toast("Ошибка сети");
  }
}

/* ==========================
   Members
   ========================== */

async function openMembers() {
  $("membersModal").classList.add("show");

  if (currentPerms.is_owner) {
    $("membersOwnerHint").textContent = "👑 Ты владелец — можешь менять роли и кикать участников.";
    $("membersAddBox").style.display = "block";
    $("leaveBtnInside").classList.add("hidden");
  } else if (currentPerms.is_moderator) {
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

async function loadMembers() {
  const list = $("membersList");
  if (!list) return;
  list.innerHTML = "<div class='text-center opacity-50 py-4'>Загрузка...</div>";

  const roleLabels = {
    owner: "👑 Владелец",
    moderator: "🛠 Модер",
    participant: "👤 Участник",
    viewer: "👁 Наблюдатель",
  };

  // DEV
  if (DEV) {
    const members = devGetMembers(currentAlbumCode);
    list.innerHTML = "";

    members.forEach((m) => {
      const item = document.createElement("div");
      item.className = "btn glass rounded-2xl px-4 py-3 flex flex-col gap-2 pointer-events-none";

      const label = roleLabels[m.role] || "Участник";
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
            ${(currentPerms.is_owner || currentPerms.is_moderator) && m.role !== "owner" && m.user_id != userId
              ? `<button onclick="kickMember(${m.user_id})" class="text-red-400 p-2 active:scale-90 transition-transform">❌</button>`
              : ""}
          </div>
        </div>

        ${currentPerms.is_owner && m.role !== "owner" ? `
          <div class="flex gap-2 mt-1 pointer-events-auto">
            <button onclick="changeRole(${m.user_id}, 'moderator')" class="text-[10px] bg-white/10 px-2 py-1 rounded-lg border border-white/10 active:bg-white/20">Модератор</button>
            <button onclick="changeRole(${m.user_id}, 'participant')" class="text-[10px] bg-white/10 px-2 py-1 rounded-lg border border-white/10 active:bg-white/20">Участник</button>
            <button onclick="changeRole(${m.user_id}, 'viewer')" class="text-[10px] bg-white/10 px-2 py-1 rounded-lg border border-white/10 active:bg-white/20">Наблюдатель</button>
          </div>
        ` : ""}
      `;
      list.appendChild(item);
    });

    if (members.length === 0) list.innerHTML = "<div class='text-center opacity-30'>Пока никого нет</div>";
    return;
  }

  // PROD
  try {
    const res = await fetch(`${API}/api/album/members?album_code=${currentAlbumCode}&user_id=${userId}`);
    const data = await res.json();
    list.innerHTML = "";

    if (!data.members || data.members.length === 0) {
      list.innerHTML = "<div class='text-center opacity-30'>Пока никого нет</div>";
      return;
    }

    data.members.forEach((m) => {
      const item = document.createElement("div");
      item.className = "btn glass rounded-2xl px-4 py-3 flex flex-col gap-2 pointer-events-none";

      const label = roleLabels[m.role] || "Участник";
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
            ${(currentPerms.is_owner || currentPerms.is_moderator) && m.role !== "owner" && m.user_id != userId
              ? `<button onclick="kickMember(${m.user_id})" class="text-red-400 p-2 active:scale-90 transition-transform">❌</button>`
              : ""}
          </div>
        </div>

        ${currentPerms.is_owner && m.role !== "owner" ? `
          <div class="flex gap-2 mt-1 pointer-events-auto">
            <button onclick="changeRole(${m.user_id}, 'moderator')" class="text-[10px] bg-white/10 px-2 py-1 rounded-lg border border-white/10 active:bg-white/20">Модератор</button>
            <button onclick="changeRole(${m.user_id}, 'participant')" class="text-[10px] bg-white/10 px-2 py-1 rounded-lg border border-white/10 active:bg-white/20">Участник</button>
          </div>
        ` : ""}
      `;
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = "<div class='text-center text-red-400'>Ошибка загрузки</div>";
  }
}

// changeRole: DEV -> local; PROD -> API
window.changeRole = async function changeRole(targetId, newRole) {
  if (!currentPerms.is_owner) {
    toast("Только владелец может менять роли");
    return;
  }
  if (!confirm(`Изменить роль пользователя на ${newRole}?`)) return;

  if (DEV) {
    const arr = devGetMembers(currentAlbumCode);
    const m = arr.find((x) => x.user_id == targetId);
    if (m && m.role !== "owner") m.role = newRole;
    toast("Роль изменена ✅ (локально)");
    await loadMembers();
    return;
  }

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
  } catch (e) {
    toast("Ошибка сети");
  }
};

// kickMember: DEV -> local; PROD -> toast placeholder
window.kickMember = async function kickMember(memberId) {
  if (!(currentPerms.is_owner || currentPerms.is_moderator)) {
    toast("Нет прав");
    return;
  }
  if (!confirm("Удалить участника из альбома?")) return;

  if (DEV) {
    const arr = devGetMembers(currentAlbumCode);
    const idx = arr.findIndex((x) => x.user_id == memberId);
    if (idx >= 0) arr.splice(idx, 1);
    toast("Участник удалён ✅ (локально)");
    await loadMembers();
    return;
  }

  // если будет API — можно добавить. Пока оставим как было:
  toast("Удаление временно недоступно через UI");
};

/* ==========================
   UI binds
   ========================== */

if ($("backBtn")) {
  $("backBtn").onclick = async () => {
    // safety: stop camera if open
    if ($("cameraModal")?.classList.contains("show")) stopCamera();

    currentAlbumCode = "";
    currentAlbumName = "";
    currentPerms = { role: "viewer", is_owner: false, can_upload: false, can_delete_any: false };

    showAlbumsScreen();
    await loadAlbums();
  };
}

if ($("galleryBtn")) {
  $("galleryBtn").onclick = () => {
    if (!currentPerms.can_upload) { toast("Нет прав на загрузку"); return; }
    galleryPicker();
  };
}

if ($("cameraBtn")) {
  $("cameraBtn").onclick = async () => {
    if (!currentPerms.can_upload) { toast("Нет прав на загрузку"); return; }
    await startCamera();
  };
}

if ($("shareBtnBottom")) {
  $("shareBtnBottom").onclick = () => {
    if (!currentPerms.is_owner) { toast("Поделиться может только владелец"); return; }
    $("shareModal").classList.add("show");
  };
}

if ($("shareClose")) $("shareClose").onclick = () => $("shareModal").classList.remove("show");
if ($("shareNoLimit")) $("shareNoLimit").onclick = () => { $("shareMaxUses").value = "0"; toast("Без лимита ✅"); };
if ($("shareLinkBtn")) $("shareLinkBtn").onclick = async () => { await shareByLink(); };
if ($("sharePersonBtn")) $("sharePersonBtn").onclick = () => { sharePersonToBot(); };

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
if ($("fullModal")) $("fullModal").onclick = (e) => { if (e.target === $("fullModal")) $("fullModal").classList.remove("show"); };
if ($("fullDownload")) $("fullDownload").onclick = downloadCurrent;
if ($("fullDelete")) $("fullDelete").onclick = deleteCurrentFull;

// close when tap outside (other modals)
for (const id of ["cameraModal", "manageModal", "membersModal", "shareModal"]) {
  const el = $(id);
  if (!el) continue;

  el.onclick = (e) => {
    if (e.target !== el) return;
    if (id === "cameraModal") stopCamera();
    else el.classList.remove("show");
  };
}

window.addEventListener("resize", () => {
  if ($("fullModal") && $("fullModal").classList.contains("show")) {
    renderFullSlides();
  }
});

attachFullGestures();

document.addEventListener("DOMContentLoaded", () => {
  showAlbumsScreen();
  loadAlbums();
});

$("cameraBtn")?.addEventListener("click", ()=>{
if(!currentPerms.can_upload){
toast("Нет доступа к загрузке")
return
}

openCamera()
})

$("previewCancel").onclick = () => {
  previewBlob = null;
  $("camPreview").classList.add("hidden");
};

$("previewUpload").onclick = async () => {

  if (!previewBlob) {
    toast("Нет фото");
    return;
  }

  await uploadFile(
    new File([previewBlob], "camera.jpg", { type: "image/jpeg" })
  );

  previewBlob = null;

  $("camPreview").classList.add("hidden");
};

// FIX: галерея → preview
document.querySelectorAll('input[type="file"]').forEach(input => {

  input.addEventListener("change", (e) => {

    const file = e.target.files?.[0];
    if(!file) return;

    previewBlob = file;

    if($("previewImg")){
      $("previewImg").src = URL.createObjectURL(file);
    }

    if($("camPreview")){
      $("camPreview").classList.remove("hidden");
    }

  });

});

$("fullDownload").onclick = async () => {

  const photo = albumPhotos[fullIndex]
  if(!photo) return

  try{

    const r = await fetch(
      `${API}/api/download_photo?url=${encodeURIComponent(photo.url)}&user_id=${userId}`
    )

    const d = await r.json()

    if(!r.ok){
      toast(d.detail || "Ошибка")
      return
    }

    toast("Фото отправлено в Telegram")

  }catch(e){
    toast("Ошибка соединения")
  }

}