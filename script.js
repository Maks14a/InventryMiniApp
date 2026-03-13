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

// const API = "https://eventry-api-vozmak.amvera.io";
const API = "https://api-horobi3906.amvera.io";  // временно

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
let previewRawBlob = null;
let previewBlob = null;
let currentCameraFilter = "original";
let camPermissionGranted = false;
let previewUploadLocked = false;

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

function getCameraCssFilter(filterName) {
  if (filterName === "bw") return "grayscale(1)";
  if (filterName === "green") return "brightness(0.96) contrast(1.02) sepia(0.18) hue-rotate(32deg) saturate(1.18)";
  if (filterName === "red") return "brightness(0.97) contrast(1.03) sepia(0.22) hue-rotate(-18deg) saturate(1.2)";
  if (filterName === "amber") return "brightness(1.01) contrast(1.02) sepia(0.3) saturate(1.14)";
  if (filterName === "violet") return "brightness(0.99) contrast(1.02) sepia(0.12) hue-rotate(220deg) saturate(1.18)";
  if (filterName === "cold") return "brightness(1.01) contrast(1.02) saturate(0.96) hue-rotate(170deg)";
  return "none";
}

function setCameraFilterUI() {
  document.querySelectorAll("[data-cam-filter]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.camFilter === currentCameraFilter);
  });

  const v = $("camVideo");
  if (v) {
    v.style.filter = getCameraCssFilter(currentCameraFilter);
  }

  const preview = $("previewImg");
  if (preview) {
    preview.style.filter = "none";
  }
}

function applyFilterToCanvas(ctx, w, h, filterName) {
  if (!filterName || filterName === "original") return;

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];

    if (filterName === "bw") {
      const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
      d[i] = gray;
      d[i + 1] = gray;
      d[i + 2] = gray;
    }

    if (filterName === "green") {
      d[i] = Math.min(255, r * 0.55);
      d[i + 1] = Math.min(255, g * 1.18 + 18);
      d[i + 2] = Math.min(255, b * 0.72);
    }

    if (filterName === "red") {
      d[i] = Math.min(255, r * 1.2 + 18);
      d[i + 1] = Math.min(255, g * 0.55);
      d[i + 2] = Math.min(255, b * 0.58);
    }

    if (filterName === "amber") {
      d[i] = Math.min(255, r * 1.1 + 16);
      d[i + 1] = Math.min(255, g * 0.92 + 8);
      d[i + 2] = Math.min(255, b * 0.62);
    }

    if (filterName === "violet") {
      d[i] = Math.min(255, r * 0.95 + 18);
      d[i + 1] = Math.min(255, g * 0.72);
      d[i + 2] = Math.min(255, b * 1.12 + 22);
    }

    if (filterName === "cold") {
      d[i] = Math.min(255, r * 0.82);
      d[i + 1] = Math.min(255, g * 0.95 + 6);
      d[i + 2] = Math.min(255, b * 1.16 + 22);
    }
  }

  ctx.putImageData(img, 0, 0);
}

async function renderFilteredPreviewFromBlob(sourceBlob, animateFromRect = null) {
  if (!sourceBlob) return;

  const img = new Image();
  const url = URL.createObjectURL(sourceBlob);

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });

  const canvas = $("camCanvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  applyFilterToCanvas(ctx, canvas.width, canvas.height, currentCameraFilter);

  const filteredBlob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
  URL.revokeObjectURL(url);

  if (!filteredBlob) {
    toast("Не удалось применить фильтр");
    return;
  }

  previewBlob = filteredBlob;

  const preview = $("previewImg");
  const previewWrap = document.querySelector(".preview-media-wrap");
  const previewRoot = $("camPreview");

  if (preview) {
    if (preview.dataset.objectUrl) {
      URL.revokeObjectURL(preview.dataset.objectUrl);
    }

    const previewUrl = URL.createObjectURL(filteredBlob);
    preview.dataset.objectUrl = previewUrl;
    preview.style.filter = "none";
    preview.src = previewUrl;
  }

  if (!previewRoot) return;

  previewRoot.classList.remove("hidden");

  await new Promise((resolve) => requestAnimationFrame(resolve));

  if (animateFromRect && previewWrap && preview) {
    await animateCaptureToPreview(animateFromRect, previewWrap, preview.src);
  }
}

async function uploadAlbumCover(file) {
  if (!file) return;

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("file", file);

  try {
    const res = await fetch(`${API}/api/album/cover/upload`, {
      method: "POST",
      body: fd
    });

    const data = await res.json();

    if (!res.ok) {
      toast(data?.detail || "Ошибка загрузки обложки");
      return;
    }

    toast("Обложка обновлена");

    // если DEV-режим, обновим локальные данные
    if (DEV) {
      const albums = devLoadAlbums();
      const idx = albums.findIndex(a => a.code === currentAlbumCode);
      if (idx !== -1) {
        albums[idx].cover_url = data.cover_url;
        devSaveAlbums(albums);
      }
    }

    await loadAlbums();
  } catch (e) {
    console.error(e);
    toast("Ошибка сети");
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

  $("topMenuBtn").classList.remove("hidden");   // ← добавить
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
          <div class="album-cover">
            ${a.cover_url
              ? `<img src="${a.cover_url}">`
              : `<span>${escapeHtml(a.name[0])}</span>`
            }
            </div>
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

    $("topMenuBtn").classList.toggle("hidden", false);

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
      $("topMenuBtn").classList.toggle("hidden", false);
    }
  } catch (e) {
    console.error(e);
  }

  await loadPhotos();
};

async function loadPhotos() {
  function setLimitText(value) {
    const text = `Лимит: ${value}`;
    if ($("uploadHint")) $("uploadHint").textContent = text;
    if ($("camLimitBadge")) $("camLimitBadge").textContent = text;
  }
  $("photoGrid").innerHTML = "<div class='text-center opacity-50 py-10'>Загрузка фото...</div>";
  $("permBadge").textContent = "Загрузка…";
  setLimitText("—");

  // DEV: без API
  if (DEV) {
    const items = devGetPhotos(currentAlbumCode);

    const badge = currentPerms.is_owner ? "Владелец" : (currentPerms.can_upload ? "Участник" : "Просмотр");
    $("permBadge").textContent = badge;

  setLimitText("—");

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

    setLimitText("—");

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

    setLimitText(remaining);

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
  $("camPreview")?.classList.add("hidden");
  $("camFiltersMenu")?.classList.remove("open");
  $("camFiltersBtn")?.classList.remove("active");
  $("camFiltersMenu")?.setAttribute("aria-hidden", "true");

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

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: cameraFacing },
        width: { ideal: 2560, max: 3840 },
        height: { ideal: 1440, max: 2160 },
        aspectRatio: { ideal: 9 / 16 },
        frameRate: { ideal: 30, max: 60 }
      }
    };

    camStream = await navigator.mediaDevices.getUserMedia(constraints);
    camPermissionGranted = true;

    const videoTrack = camStream.getVideoTracks?.()[0];
    if (videoTrack?.applyConstraints) {
      try {
        await videoTrack.applyConstraints({
          width: { ideal: 2560, max: 3840 },
          height: { ideal: 1440, max: 2160 },
          frameRate: { ideal: 30, max: 60 }
        });
      } catch (_) {}
    }

    v.srcObject = camStream;

    await new Promise((resolve) => {
      const done = () => resolve();
      v.onloadedmetadata = done;
      setTimeout(done, 700);
    });

    v.style.transform = cameraFacing === "user" ? "scaleX(-1)" : "none";
    await v.play();
    setCameraFilterUI();
  } catch (e) {
    console.log(e);
    toast("Камера недоступна");
  }
}

function stopCamera() {
  $("cameraModal").classList.remove("show");
  $("camFiltersMenu")?.classList.remove("open");
  $("camFiltersBtn")?.classList.remove("active");
  $("camFiltersMenu")?.setAttribute("aria-hidden", "true");
  $("camPreview")?.classList.add("hidden");

  previewUploadLocked = false;

  const uploadBtn = $("previewUpload");
  if (uploadBtn) {
    uploadBtn.disabled = false;
    uploadBtn.style.opacity = "1";
    uploadBtn.style.pointerEvents = "auto";
    uploadBtn.textContent = "Загрузить";
  }

  previewBlob = null;
  previewRawBlob = null;

  const v = $("camVideo");
  if (v) {
    v.style.filter = "none";
    v.style.transform = "none";
    try { v.pause(); } catch (_) {}
    v.srcObject = null;
  }

  const preview = $("previewImg");
  if (preview) {
    preview.style.filter = "none";
    if (preview.dataset.objectUrl) {
      URL.revokeObjectURL(preview.dataset.objectUrl);
      preview.dataset.objectUrl = "";
    }
    preview.src = "";
  }

  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }
}

async function flipCamera() {
  cameraFacing = cameraFacing === "environment" ? "user" : "environment";
  await startCamera();
}

async function takeShot() {
  try {
    const v = $("camVideo");
    if (!v || !v.videoWidth) {
      toast("Нет видео — жми «Файл»");
      return;
    }

    const fromRect = v.getBoundingClientRect();

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

    const rawBlob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!rawBlob) {
      toast("Не удалось сделать фото");
      return;
    }

    previewRawBlob = rawBlob;
    await renderFilteredPreviewFromBlob(rawBlob, fromRect);

    $("camFiltersMenu")?.classList.remove("open");
    $("camFiltersBtn")?.classList.remove("active");
    $("camFiltersMenu")?.setAttribute("aria-hidden", "true");
  } catch (e) {
    console.log(e);
    toast("Ошибка камеры");
  }
}

async function animateCaptureToPreview(fromRect, toElement, imageSrc) {
  if (!fromRect || !toElement || !imageSrc) return;

  const toRect = toElement.getBoundingClientRect();

  const ghost = document.createElement("div");
  ghost.className = "capture-fly-thumb";
  ghost.style.left = `${fromRect.left}px`;
  ghost.style.top = `${fromRect.top}px`;
  ghost.style.width = `${fromRect.width}px`;
  ghost.style.height = `${fromRect.height}px`;
  ghost.style.opacity = "1";

  ghost.innerHTML = `<img src="${imageSrc}" alt="">`;
  document.body.appendChild(ghost);

  toElement.style.opacity = "0";

  await new Promise((resolve) => requestAnimationFrame(resolve));

  ghost.style.transition = [
    "left .42s cubic-bezier(.2,.8,.2,1)",
    "top .42s cubic-bezier(.2,.8,.2,1)",
    "width .42s cubic-bezier(.2,.8,.2,1)",
    "height .42s cubic-bezier(.2,.8,.2,1)",
    "opacity .42s ease",
    "transform .42s cubic-bezier(.2,.8,.2,1)"
  ].join(", ");

  ghost.style.left = `${toRect.left}px`;
  ghost.style.top = `${toRect.top}px`;
  ghost.style.width = `${toRect.width}px`;
  ghost.style.height = `${toRect.height}px`;
  ghost.style.transform = "scale(.98)";

  await new Promise((resolve) => setTimeout(resolve, 430));

  toElement.style.opacity = "1";
  ghost.style.opacity = "0";

  setTimeout(() => {
    ghost.remove();
  }, 180);
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

  const renameBtn = $("renameBtn");
  const changeCoverBtn = $("changeCoverBtn");
  const membersBtn = $("membersBtn");
  const deleteAlbumBtn = $("deleteAlbumBtn");
  const leaveBtn = $("leaveBtn");
  const manageModal = $("manageModal");

  if (renameBtn) renameBtn.style.display = currentPerms.is_owner ? "flex" : "none";
  if (changeCoverBtn) changeCoverBtn.style.display = currentPerms.is_owner ? "flex" : "none";
  if (membersBtn) membersBtn.style.display = "flex";
  if (deleteAlbumBtn) deleteAlbumBtn.style.display = currentPerms.is_owner ? "flex" : "none";
  if (leaveBtn) leaveBtn.style.display = currentPerms.is_owner ? "none" : "flex";

  if (manageModal) manageModal.classList.add("show");
}

function getShareRights() {
  const can_upload = $("shareCanUpload").checked;
  const can_delete = $("shareCanDelete").checked;
  const flags = (can_upload ? "1" : "0") + (can_delete ? "1" : "0");
  return { can_upload, can_delete, flags };
}

function getShareMaxUses() {
  return 1;
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
  fd.append("max_uses", "1");
  fd.append("ttl_hours", "5");

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
  const maxUses = 1;

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

  if ($("leaveBtnInside")) {
    $("leaveBtnInside").classList.toggle("hidden", !!currentPerms.is_owner);
  }

  await loadMembers();
}

async function loadMembers() {
  const list = $("membersList");
  if (!list) return;

  list.innerHTML = "<div class='member-empty'>Загрузка...</div>";

  const roleLabels = {
    owner: "Владелец",
    moderator: "Модератор",
    participant: "Участник",
    viewer: "Наблюдатель",
  };

  function displayNameOf(m) {
    return escapeHtml(m.first_name || (m.username ? "@" + m.username : "Гость"));
  }

  function initialOf(m) {
    return (m.first_name || m.username || "U").toString().charAt(0).toUpperCase();
  }

  function avatarHtml(m) {
    if (m.user_id && Number(m.user_id) !== 112) {
      return `<img src="${API}/api/avatar/${m.user_id}" alt="">`;
    }
    return `<span>${initialOf(m)}</span>`;
  }

  function canOpenActionsFor(m) {
    if (m.user_id == userId) return false;
    if (m.role === "owner") return false;
    return !!(currentPerms.is_owner || currentPerms.is_moderator);
  }

  function renderRow(m) {
    const btn = document.createElement("button");
    btn.className = "btn member-row";
    btn.type = "button";

    const label = roleLabels[m.role] || "Участник";
    const clickable = canOpenActionsFor(m);

    btn.innerHTML = `
      <div class="member-avatar">
        ${avatarHtml(m)}
      </div>

      <div class="member-main">
        <div class="member-name">${displayNameOf(m)}</div>
        <div class="member-role">${label}</div>
      </div>

      <div class="member-arrow">
        ${clickable ? `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 6l6 6-6 6"></path>
          </svg>
        ` : ``}
      </div>
    `;

    if (clickable) {
      btn.onclick = () => openMemberActions(m);
    } else {
      btn.style.opacity = "0.92";
    }

    return btn;
  }

  // DEV
  if (DEV) {
    const members = devGetMembers(currentAlbumCode);
    list.innerHTML = "";

    if (!members.length) {
      list.innerHTML = "<div class='member-empty'>Пока никого нет</div>";
      return;
    }

    members.forEach((m) => list.appendChild(renderRow(m)));
    return;
  }

  // PROD
  try {
    const res = await fetch(`${API}/api/album/members?album_code=${currentAlbumCode}&user_id=${userId}`);
    const data = await res.json();

    list.innerHTML = "";

    if (!data.members || !data.members.length) {
      list.innerHTML = "<div class='member-empty'>Пока никого нет</div>";
      return;
    }

    data.members.forEach((m) => list.appendChild(renderRow(m)));
  } catch (e) {
    list.innerHTML = "<div class='member-empty'>Не удалось загрузить список</div>";
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

  if (Number(memberId) === Number(userId)) {
    toast("Нельзя удалить себя");
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

  const fd = new FormData();
  fd.append("album_code", currentAlbumCode);
  fd.append("user_id", userId);
  fd.append("target_id", memberId);

  try {
    const res = await fetch(`${API}/api/member/kick`, {
      method: "POST",
      body: fd
    });

    const data = await res.json();

    if (!res.ok) {
      toast(data?.detail || "Не удалось удалить участника");
      return;
    }

    toast("Участник удалён");
    await loadMembers();
  } catch (e) {
    toast("Ошибка сети");
  }
};

let currentMemberActions = null;

function openMemberActions(member) {
  currentMemberActions = member;

  const body = $("memberActionsBody");
  const title = $("memberActionsTitle");
  if (!body || !title) return;

  const roleLabels = {
    owner: "Владелец",
    moderator: "Модератор",
    participant: "Участник",
    viewer: "Наблюдатель",
  };

  const displayName = escapeHtml(member.first_name || (member.username ? "@" + member.username : "Гость"));
  const roleLabel = roleLabels[member.role] || "Участник";
  const initial = (member.first_name || member.username || "U").toString().charAt(0).toUpperCase();

  title.textContent = "Управление";

  body.innerHTML = `
    <div class="member-preview">
      <div class="member-avatar">
        ${member.user_id && Number(member.user_id) !== 112
          ? `<img src="${API}/api/avatar/${member.user_id}" alt="">`
          : `<span>${initial}</span>`
        }
      </div>
      <div>
        <div class="member-preview-name">${displayName}</div>
        <div class="member-preview-role">${roleLabel}</div>
      </div>
    </div>
  `;

  if (currentPerms.is_owner) {
    body.innerHTML += `
      <button class="btn action-btn" onclick="changeRole(${member.user_id}, 'moderator'); closeMemberActions();">
        <span class="action-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l2.8 5.67L21 9.6l-4.5 4.39L17.56 21 12 18.1 6.44 21 7.5 13.99 3 9.6l6.2-.93L12 3Z"></path>
          </svg>
        </span>
        <span class="action-label">Сделать модератором</span>
      </button>

      <button class="btn action-btn" onclick="changeRole(${member.user_id}, 'participant'); closeMemberActions();">
        <span class="action-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="8" r="4"></circle>
            <path d="M5.5 21a6.5 6.5 0 0 1 13 0"></path>
          </svg>
        </span>
        <span class="action-label">Сделать участником</span>
      </button>

      <button class="btn action-btn" onclick="changeRole(${member.user_id}, 'viewer'); closeMemberActions();">
        <span class="action-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </span>
        <span class="action-label">Сделать наблюдателем</span>
      </button>
    `;
  }

  if (currentPerms.is_owner || currentPerms.is_moderator) {
    body.innerHTML += `
      <button class="btn action-btn member-action-danger" onclick="kickMember(${member.user_id}); closeMemberActions();">
        <span class="action-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18"></path>
            <path d="M6 6l12 12"></path>
          </svg>
        </span>
        <span class="action-label">Удалить из альбома</span>
      </button>
    `;
  }

  $("memberActionsModal")?.classList.add("show");
}

function closeMemberActions() {
  $("memberActionsModal")?.classList.remove("show");
}

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
if ($("shareLinkBtn")) $("shareLinkBtn").onclick = async () => { await shareByLink(); };
if ($("sharePersonBtn")) $("sharePersonBtn").onclick = () => { sharePersonToBot(); };

if ($("cameraClose")) $("cameraClose").onclick = stopCamera;
if ($("camFallback")) $("camFallback").onclick = cameraFallback;
if ($("camShot")) $("camShot").onclick = takeShot;
if ($("camFlip")) $("camFlip").onclick = flipCamera;
if ($("camFiltersBtn")) {
  $("camFiltersBtn").onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const menu = $("camFiltersMenu");
    if (!menu) return;

    const isOpen = menu.classList.toggle("open");
    $("camFiltersBtn").classList.toggle("active", isOpen);
    menu.setAttribute("aria-hidden", isOpen ? "false" : "true");

    setCameraFilterUI();
  };
}

if ($("camFiltersClose")) {
  $("camFiltersClose").onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    $("camFiltersMenu")?.classList.remove("open");
    $("camFiltersBtn")?.classList.remove("active");
    $("camFiltersMenu")?.setAttribute("aria-hidden", "true");
  };
}

document.querySelectorAll("[data-cam-filter]").forEach((btn) => {
  btn.onclick = async () => {
    currentCameraFilter = btn.dataset.camFilter;
    setCameraFilterUI();

    if (!$("camPreview").classList.contains("hidden") && previewRawBlob) {
      await renderFilteredPreviewFromBlob(previewRawBlob);
    }

    $("camFiltersMenu")?.classList.remove("open");
    $("camFiltersBtn")?.classList.remove("active");
    $("camFiltersMenu")?.setAttribute("aria-hidden", "true");
  };
});

if ($("manageClose")) $("manageClose").onclick = () => $("manageModal").classList.remove("show");
if ($("membersClose")) $("membersClose").onclick = () => $("membersModal").classList.remove("show");
if ($("memberActionsClose")) $("memberActionsClose").onclick = closeMemberActions;

if ($("renameBtn")) $("renameBtn").onclick = renameAlbum;
if ($("membersBtn")) $("membersBtn").onclick = async () => { $("manageModal").classList.remove("show"); await openMembers(); };
if ($("deleteAlbumBtn")) $("deleteAlbumBtn").onclick = deleteAlbum;

if ($("leaveBtn")) $("leaveBtn").onclick = leaveAlbum;
if ($("leaveBtnInside")) $("leaveBtnInside").onclick = leaveAlbum;

if ($("changeCoverBtn")) {
  $("changeCoverBtn").onclick = () => {
    if (!(currentPerms.is_owner || currentPerms.is_moderator)) {
      toast("Нет прав менять обложку");
      return;
    }
    $("coverFileInput")?.click();
  };
}

// fullscreen buttons
if ($("fullClose")) $("fullClose").onclick = () => $("fullModal").classList.remove("show");
if ($("fullModal")) $("fullModal").onclick = (e) => { if (e.target === $("fullModal")) $("fullModal").classList.remove("show"); };
if ($("fullDownload")) $("fullDownload").onclick = downloadCurrent;
if ($("fullDelete")) $("fullDelete").onclick = deleteCurrentFull;

// close when tap outside (other modals)
for (const id of ["cameraModal", "manageModal", "membersModal", "shareModal", "memberActionsModal"]) {
  const el = $(id);
  if (!el) continue;

  el.onclick = (e) => {
    if (id === "cameraModal") {
      if (e.target === $("camFiltersMenu") || $("camFiltersMenu")?.contains(e.target)) return;
      if (e.target === $("camFiltersBtn") || $("camFiltersBtn")?.contains(e.target)) return;
    }

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
  previewUploadLocked = false;

  const uploadBtn = $("previewUpload");
  if (uploadBtn) {
    uploadBtn.disabled = false;
    uploadBtn.style.opacity = "1";
    uploadBtn.style.pointerEvents = "auto";
    uploadBtn.textContent = "Загрузить";
  }

  const preview = $("previewImg");
  if (preview?.dataset.objectUrl) {
    URL.revokeObjectURL(preview.dataset.objectUrl);
    preview.dataset.objectUrl = "";
  }

  if (preview) {
    preview.src = "";
    preview.style.opacity = "1";
  }

  previewBlob = null;
  previewRawBlob = null;
  $("camPreview").classList.add("hidden");
};

$("previewUpload").onclick = async () => {
  if (previewUploadLocked) return;

  if (!previewBlob) {
    toast("Нет фото");
    return;
  }

  previewUploadLocked = true;

  const uploadBtn = $("previewUpload");
  if (uploadBtn) {
    uploadBtn.disabled = true;
    uploadBtn.style.opacity = "0.6";
    uploadBtn.style.pointerEvents = "none";
    uploadBtn.textContent = "Загрузка...";
  }

  try {
    await uploadFile(
      new File([previewBlob], "camera.jpg", { type: "image/jpeg" })
    );

    const preview = $("previewImg");
    if (preview?.dataset.objectUrl) {
      URL.revokeObjectURL(preview.dataset.objectUrl);
      preview.dataset.objectUrl = "";
    }

    if (preview) {
      preview.src = "";
      preview.style.opacity = "1";
    }

    previewBlob = null;
    previewRawBlob = null;
    $("camPreview").classList.add("hidden");
  } finally {
    previewUploadLocked = false;

    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.style.opacity = "1";
      uploadBtn.style.pointerEvents = "auto";
      uploadBtn.textContent = "Загрузить";
    }
  }
};

// FIX: галерея → preview
document.querySelectorAll('input[type="file"]:not(#coverFileInput)').forEach(input => {
  input.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    previewBlob = file;

    if ($("previewImg")) {
      $("previewImg").src = URL.createObjectURL(file);
    }

    previewUploadLocked = false;

    const uploadBtn = $("previewUpload");
    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.style.opacity = "1";
      uploadBtn.style.pointerEvents = "auto";
      uploadBtn.textContent = "Загрузить";
    }

    if ($("camPreview")) {

      previewUploadLocked = false;

      const uploadBtn = $("previewUpload");
      if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.style.opacity = "1";
        uploadBtn.style.pointerEvents = "auto";
        uploadBtn.textContent = "Загрузить";
      }

      $("camPreview").classList.remove("hidden");
    }
  });
});

if ($("coverFileInput")) {
  $("coverFileInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await uploadAlbumCover(file);
    e.target.value = "";
  });
}

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