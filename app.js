/**
 * ============================================================================
 * AeroSense - Dashboard Monitoring Kualitas Udara
 * Auto Connect Firebase Realtime Database & Sensor Stream Engine
 * Desain Light Theme, Icon-Only Wifi, Data Handling & Rekomendasi Cerdas
 * ============================================================================
 */

// Konfigurasi Firebase Realtime Database
const firebaseConfig = {
  apiKey: "AIzaSyDeLnkzLtUDfzLILH3zeQP7z27m6IrUUDU",
  authDomain: "air-quality-monitoring-28ee2.firebaseapp.com",
  databaseURL: "https://air-quality-monitoring-28ee2-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "air-quality-monitoring-28ee2",
  storageBucket: "air-quality-monitoring-28ee2.firebasestorage.app",
  messagingSenderId: "451558795347",
  appId: "1:451558795347:web:2625e5d705e75289907ea6"
};

// State Global Dashboard
const AppState = {
  isConfigured: true,
  isDemoMode: false,
  lastPacketTime: null,
  activeChartTab: 'ppm', // 'ppm' | 'climate' | 'pm25'
  maxHistoryPoints: 20,
  historyData: [],
  demoTimer: null,
  watchdogTimer: null,
  chartInstance: null,
  offlineThresholdSeconds: 35
};


const THRESHOLDS = {
  GOOD_MAX: 119,        // 0 - 119 PPM = Baik (Hijau)
  MODERATE_MAX: 349,    // 120 - 349 PPM = Sedang (Kuning - Parfum terdeteksi di sini)
  // >= 350 PPM = Berbahaya / Buruk (Merah - Gas korek api)
  PM25_GOOD_MAX: 35,
  PM25_MODERATE_MAX: 75
};

// Inisialisasi Saat Halaman Selesai Dimuat
document.addEventListener('DOMContentLoaded', () => {
  initDOMListeners();
  initMobileDrawer();
  initScrollReveal();
  initChart();
  setDeviceStatus('connecting');
  initFirebase();
  startWatchdogTimer();
});

/**
 * 1. Mobile Off-Canvas Drawer (Tombol Garis 3 Menu di Pojok Kiri Atas)
 */
function initMobileDrawer() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const closeMobileMenuBtn = document.getElementById('closeMobileMenuBtn');
  const drawer = document.getElementById('mobileMenuDrawer');
  const backdrop = document.getElementById('mobileMenuBackdrop');
  const navLinks = document.querySelectorAll('.mobile-nav-link');
  const btnDrawerToggleDemo = document.getElementById('btnDrawerToggleDemo');

  const openDrawer = () => {
    if (!drawer || !backdrop) return;
    drawer.classList.remove('-translate-x-full');
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    document.body.style.overflow = 'hidden';
  };

  const closeDrawer = () => {
    if (!drawer || !backdrop) return;
    drawer.classList.add('-translate-x-full');
    backdrop.classList.add('opacity-0', 'pointer-events-none');
    document.body.style.overflow = '';
  };

  if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openDrawer);
  if (closeMobileMenuBtn) closeMobileMenuBtn.addEventListener('click', closeDrawer);
  if (backdrop) backdrop.addEventListener('click', closeDrawer);

  navLinks.forEach(link => {
    link.addEventListener('click', closeDrawer);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
  });

  if (btnDrawerToggleDemo) {
    btnDrawerToggleDemo.addEventListener('click', () => {
      closeDrawer();
      toggleDemoMode();
    });
  }
}

/**
 * 2. Animasi Scroll & Kemunculan Elemen (Scroll Reveal via Intersection Observer)
 */
function initScrollReveal() {
  const revealElements = document.querySelectorAll('.reveal-on-scroll');

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.08,
      rootMargin: '0px 0px -40px 0px'
    });

    revealElements.forEach((el, index) => {
      el.style.transitionDelay = `${Math.min(index * 70, 280)}ms`;
      observer.observe(el);
    });
  } else {
    revealElements.forEach(el => el.classList.add('revealed'));
  }
}

/**
 * 3. Inisialisasi & Auto Connect Firebase Realtime Database
 * Mendengarkan node `/sensor` (aktif), serta fallback `/air_quality/live` dan `/live`
 */
function initFirebase() {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.database();
    setDeviceStatus('connecting');

    // Listener Utama Node Aktif: `/sensor` (Format data langsung dari perangkat)
    const sensorRef = db.ref('sensor');
    sensorRef.on('value', (snapshot) => {
      const data = snapshot.val();
      if (data && typeof data === 'object') {
        processIncomingData(data, 'sensor');
      } else {
        // Fallback jika node /sensor kosong
        db.ref('air_quality/live').once('value').then((fallbackSnap) => {
          const fallbackData = fallbackSnap.val();
          if (fallbackData) processIncomingData(fallbackData, 'air_quality/live');
        });
      }
    }, (error) => {
      console.warn("Firebase /sensor read notice:", error);
      setDeviceStatus('offline');
    });

  } catch (err) {
    console.error("Kesalahan inisialisasi Firebase:", err);
    setDeviceStatus('offline');
  }
}

/**
 * 4. Pemrosesan Data Masuk dari Sensor Ruangan
 * Mendukung penamaan bahasa Indonesia (suhu, kelembapan) dan bahasa Inggris (temp, humidity)
 * Jika hardware belum ada (misal PM2.5), nilainya adalah null dan ditampilkan sebagai '--'
 */
function processIncomingData(raw, sourcePath = '') {
  if (!raw || typeof raw !== 'object') return;

  AppState.lastPacketTime = Date.now();
  const packetTimestamp = Date.now();

  // Validasi keberadaan masing-masing data
  const hasPpm = (raw.ppm !== undefined && raw.ppm !== null && raw.ppm !== "") ||
    (raw.gas !== undefined && raw.gas !== null && raw.gas !== "");

  const hasTemp = (raw.temp !== undefined && raw.temp !== null && raw.temp !== "") ||
    (raw.suhu !== undefined && raw.suhu !== null && raw.suhu !== "");

  const hasHumidity = (raw.humidity !== undefined && raw.humidity !== null && raw.humidity !== "") ||
    (raw.kelembapan !== undefined && raw.kelembapan !== null && raw.kelembapan !== "");

  const hasPm25 = (raw.pm25 !== undefined && raw.pm25 !== null && raw.pm25 !== "");

  // Ekstraksi nilai angka murni atau null jika sensor/data belum ada
  const ppm = hasPpm ? Number(raw.ppm !== undefined ? raw.ppm : raw.gas) : null;
  const temp = hasTemp ? Number(raw.temp !== undefined ? raw.temp : raw.suhu) : null;
  const humidity = hasHumidity ? Number(raw.humidity !== undefined ? raw.humidity : raw.kelembapan) : null;

  // Jika bukan mode simulasi dan hardware PM2.5 belum ada, JANGAN buat data palsu! Tetap null
  let pm25 = null;
  if (hasPm25) {
    pm25 = Number(raw.pm25);
  } else if (AppState.isDemoMode) {
    // Hanya dalam mode demo simulasi
    pm25 = Math.max(5, Math.round(((ppm || 300) / 25) * 10) / 10);
  }

  const evaluatedStatus = evaluateAirQuality(ppm !== null ? ppm : 0, pm25 || 0);
  const statusText = raw.status || evaluatedStatus.label;

  const currentReading = {
    ppm,
    temp,
    humidity,
    pm25,
    status: statusText,
    category: evaluatedStatus,
    timestamp: packetTimestamp,
    hasHardware: {
      ppm: hasPpm,
      temp: hasTemp,
      humidity: hasHumidity,
      pm25: hasPm25 || AppState.isDemoMode
    }
  };

  updateDashboardDOM(currentReading);
  updateActionRecommendation(currentReading);
  appendToLocalHistory(currentReading);
  setDeviceStatus('online');
}

/**
 * 5. Evaluasi Ambang Batas Kualitas Udara
 */
function evaluateAirQuality(ppm, pm25 = 0) {
  if (ppm <= THRESHOLDS.GOOD_MAX && pm25 <= THRESHOLDS.PM25_GOOD_MAX) {
    return {
      level: 'good',
      label: 'Baik',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      glowClass: 'glow-good',
      icon: 'fa-circle-check',
      ispu: 'BAIK',
      advice: 'Kualitas udara ruangan sangat bersih dan segar. Bebas risiko polutan, aman untuk bernapas bebas dan sirkulasi alami.',
      scalePercent: Math.min(33, Math.max(8, (ppm / THRESHOLDS.GOOD_MAX) * 33))
    };
  } else if (ppm <= THRESHOLDS.MODERATE_MAX && pm25 <= THRESHOLDS.PM25_MODERATE_MAX) {
    return {
      level: 'moderate',
      label: 'Sedang',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
      glowClass: 'glow-moderate',
      icon: 'fa-triangle-exclamation',
      ispu: 'SEDANG',
      advice: 'Konsentrasi gas terdeteksi meningkat dalam taraf wajar. Disarankan menyalakan kipas sirkulasi atau membuka ventilasi ruangan.',
      scalePercent: 33 + Math.min(33, ((ppm - THRESHOLDS.GOOD_MAX) / (THRESHOLDS.MODERATE_MAX - THRESHOLDS.GOOD_MAX)) * 33)
    };
  } else {
    return {
      level: 'hazardous',
      label: 'Berbahaya',
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
      glowClass: 'glow-hazardous',
      icon: 'fa-circle-radiation',
      ispu: 'BERBAHAYA',
      advice: 'Peringatan: Polusi tinggi atau kebocoran gas terdeteksi! Gunakan masker, nyalakan pembersih udara, atau perbaiki ventilasi segera.',
      scalePercent: Math.min(96, 66 + ((ppm - THRESHOLDS.MODERATE_MAX) / 1000) * 30)
    };
  }
}

/**
 * 6. Saran Aksi Cerdas Dinamis di Bagian Teratas
 */
function updateActionRecommendation(reading) {
  const { ppm, temp, humidity, pm25, category, hasHardware } = reading;

  const cardEl = document.getElementById('actionBannerCard');
  const badgeEl = document.getElementById('actionLevelBadge');
  const titleEl = document.getElementById('actionBannerTitle');
  const descEl = document.getElementById('actionBannerDesc');
  const checklistEl = document.getElementById('actionChecklistContainer');
  const tempBadgeEl = document.getElementById('climateTempBadge');
  const humBadgeEl = document.getElementById('climateHumBadge');

  const svgGood = document.getElementById('svgIllustrationGood');
  const svgModerate = document.getElementById('svgIllustrationModerate');
  const svgHazardous = document.getElementById('svgIllustrationHazardous');

  // Jika data belum ada sama sekali
  if (ppm === null && temp === null && humidity === null) {
    if (badgeEl) {
      badgeEl.className = 'inline-flex items-center px-3.5 py-1 rounded-full text-xs font-bold tracking-wide uppercase bg-slate-100 text-slate-700 border border-slate-300 shadow-sm';
      badgeEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-xs text-blue-600"></i> Membaca Kondisi Ruangan...`;
    }
    if (titleEl) titleEl.textContent = 'Menghubungkan ke Sensor Ruangan...';
    if (descEl) descEl.textContent = 'Sistem sedang membaca data kualitas udara. Rekomendasi tindakan akan langsung ditampilkan setelah data terdeteksi.';
    if (tempBadgeEl) tempBadgeEl.textContent = '🌡️ Suhu: --';
    if (humBadgeEl) humBadgeEl.textContent = '💧 Kelembapan: --';
    return;
  }

  if (category.level === 'good') {
    if (badgeEl) {
      badgeEl.className = 'inline-flex items-center px-3.5 py-1 rounded-full text-xs font-bold tracking-wide uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-sm';
      badgeEl.innerHTML = `<i class="fa-solid fa-shield-heart mr-1.5 text-xs text-emerald-600"></i> Kondisi Ruangan: Sangat Sehat (Optimal)`;
    }
    if (titleEl) titleEl.textContent = 'Buka Jendela untuk Menikmati Udara Segar Alami!';
    if (descEl) {
      descEl.textContent = `Kualitas udara ruangan berada pada level prima${ppm !== null ? ` (${ppm} PPM)` : ''}. Sirkulasi oksigen sangat optimal untuk fokus kerja, belajar, dan kesehatan pernapasan seluruh keluarga.`;
    }
    if (cardEl) {
      cardEl.className = 'reveal-on-scroll card-light rounded-2xl sm:rounded-3xl p-5 sm:p-7 transition-all duration-500 border border-emerald-200/90 shadow-[0_8px_30px_rgb(16,185,129,0.08)] bg-gradient-to-br from-white via-emerald-50/30 to-blue-50/20 relative overflow-hidden revealed';
    }
    if (checklistEl) {
      checklistEl.innerHTML = `
        <div class="action-pill p-2.5 rounded-xl bg-white border border-emerald-100 shadow-sm flex items-start space-x-2.5">
          <span class="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 text-xs font-bold">
            <i class="fa-solid fa-door-open"></i>
          </span>
          <div>
            <p class="text-xs font-bold text-slate-800">Ventilasi Ruangan</p>
            <p class="text-[11px] text-slate-500">Buka jendela untuk pertukaran udara alami</p>
          </div>
        </div>
        <div class="action-pill p-2.5 rounded-xl bg-white border border-blue-100 shadow-sm flex items-start space-x-2.5">
          <span class="w-6 h-6 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 text-xs font-bold">
            <i class="fa-solid fa-person-running"></i>
          </span>
          <div>
            <p class="text-xs font-bold text-slate-800">Aktivitas Fisik</p>
            <p class="text-[11px] text-slate-500">Sangat aman untuk senam & olahraga</p>
          </div>
        </div>
        <div class="action-pill p-2.5 rounded-xl bg-white border border-sky-100 shadow-sm flex items-start space-x-2.5">
          <span class="w-6 h-6 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center shrink-0 text-xs font-bold">
            <i class="fa-solid fa-leaf"></i>
          </span>
          <div>
            <p class="text-xs font-bold text-slate-800">Kebugaran Alami</p>
            <p class="text-[11px] text-slate-500">Oksigen segar bantu konsentrasi prima</p>
          </div>
        </div>
      `;
    }

    if (svgGood) svgGood.classList.remove('hidden');
    if (svgModerate) svgModerate.classList.add('hidden');
    if (svgHazardous) svgHazardous.classList.add('hidden');

  } else if (category.level === 'moderate') {
    if (badgeEl) {
      badgeEl.className = 'inline-flex items-center px-3.5 py-1 rounded-full text-xs font-bold tracking-wide uppercase bg-amber-100 text-amber-800 border border-amber-300 shadow-sm';
      badgeEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-1.5 text-xs text-amber-600"></i> Kondisi Ruangan: Udara Sedang (Perlu Perhatian)`;
    }
    if (titleEl) titleEl.textContent = 'Tingkatkan Sirkulasi & Nyalakan Kipas / Ventilasi!';
    if (descEl) {
      descEl.textContent = `Kadar gas atau partikel terdeteksi meningkat${ppm !== null ? ` (${ppm} PPM)` : ''}. Ruangan terasa agak pengap. Segera alirkan udara segar agar tidak menumpuk.`;
    }
    if (cardEl) {
      cardEl.className = 'reveal-on-scroll card-light rounded-2xl sm:rounded-3xl p-5 sm:p-7 transition-all duration-500 border border-amber-200/90 shadow-[0_8px_30px_rgb(245,158,11,0.08)] bg-gradient-to-br from-white via-amber-50/40 to-blue-50/20 relative overflow-hidden revealed';
    }
    if (checklistEl) {
      checklistEl.innerHTML = `
        <div class="action-pill p-2.5 rounded-xl bg-white border border-amber-100 shadow-sm flex items-start space-x-2.5">
          <span class="w-6 h-6 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 text-xs font-bold">
            <i class="fa-solid fa-fan"></i>
          </span>
          <div>
            <p class="text-xs font-bold text-slate-800">Sirkulasi Kipas</p>
            <p class="text-[11px] text-slate-500">Nyalakan exhaust fan atau kipas angin</p>
          </div>
        </div>
        <div class="action-pill p-2.5 rounded-xl bg-white border border-blue-100 shadow-sm flex items-start space-x-2.5">
          <span class="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 text-xs font-bold">
            <i class="fa-solid fa-wind"></i>
          </span>
          <div>
            <p class="text-xs font-bold text-slate-800">Pembersih Udara</p>
            <p class="text-[11px] text-slate-500">Gunakan mode sirkulasi pembersih udara</p>
          </div>
        </div>
        <div class="action-pill p-2.5 rounded-xl bg-white border border-sky-100 shadow-sm flex items-start space-x-2.5">
          <span class="w-6 h-6 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0 text-xs font-bold">
            <i class="fa-solid fa-user-shield"></i>
          </span>
          <div>
            <p class="text-xs font-bold text-slate-800">Kelompok Sensitif</p>
            <p class="text-[11px] text-slate-500">Penderita asma & balita batasi kelelahan</p>
          </div>
        </div>
      `;
    }

    if (svgGood) svgGood.classList.add('hidden');
    if (svgModerate) svgModerate.classList.remove('hidden');
    if (svgHazardous) svgHazardous.classList.add('hidden');

  } else {
    if (badgeEl) {
      badgeEl.className = 'inline-flex items-center px-3.5 py-1 rounded-full text-xs font-bold tracking-wide uppercase bg-rose-100 text-rose-800 border border-rose-300 shadow-sm';
      badgeEl.innerHTML = `<i class="fa-solid fa-circle-radiation mr-1.5 text-xs text-rose-600"></i> Peringatan: Kualitas Udara Buruk / Kritis!`;
    }
    if (titleEl) titleEl.textContent = 'Nyalakan Pembersih Udara & Gunakan Masker Segera!';
    if (descEl) {
      descEl.textContent = `Peringatan Kritis! Kadar gas berbahaya atau asap tinggi terdeteksi${ppm !== null ? ` (${ppm} PPM)` : ''}. Segera lakukan tindakan perlindungan pernapasan dan buka sirkulasi darurat.`;
    }
    if (cardEl) {
      cardEl.className = 'reveal-on-scroll card-light rounded-2xl sm:rounded-3xl p-5 sm:p-7 transition-all duration-500 border border-rose-300 shadow-[0_8px_35px_rgb(239,68,68,0.12)] bg-gradient-to-br from-white via-rose-50/50 to-orange-50/30 relative overflow-hidden revealed';
    }
    if (checklistEl) {
      checklistEl.innerHTML = `
        <div class="action-pill p-2.5 rounded-xl bg-white border border-rose-200 shadow-sm flex items-start space-x-2.5">
          <span class="w-6 h-6 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 text-xs font-bold">
            <i class="fa-solid fa-shield-virus"></i>
          </span>
          <div>
            <p class="text-xs font-bold text-slate-800">Pembersih Udara Maksimal</p>
            <p class="text-[11px] text-slate-500">Aktifkan filtrasi kecepatan penuh</p>
          </div>
        </div>
        <div class="action-pill p-2.5 rounded-xl bg-white border border-rose-200 shadow-sm flex items-start space-x-2.5">
          <span class="w-6 h-6 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 text-xs font-bold">
            <i class="fa-solid fa-head-side-mask"></i>
          </span>
          <div>
            <p class="text-xs font-bold text-slate-800">Kenakan Masker</p>
            <p class="text-[11px] text-slate-500">Pakai masker pelindung di dalam ruangan</p>
          </div>
        </div>
        <div class="action-pill p-2.5 rounded-xl bg-white border border-rose-200 shadow-sm flex items-start space-x-2.5">
          <span class="w-6 h-6 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 text-xs font-bold">
            <i class="fa-solid fa-person-shelter"></i>
          </span>
          <div>
            <p class="text-xs font-bold text-slate-800">Cek Sumber Polusi</p>
            <p class="text-[11px] text-slate-500">Tutup jendela luar & evakuasi jika berbau</p>
          </div>
        </div>
      `;
    }

    if (svgGood) svgGood.classList.add('hidden');
    if (svgModerate) svgModerate.classList.add('hidden');
    if (svgHazardous) svgHazardous.classList.remove('hidden');
  }

  // Tag Iklim Pintar Suhu & Kelembapan
  if (tempBadgeEl) {
    if (temp !== null) {
      if (temp > 30.5) {
        tempBadgeEl.className = 'px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-300 font-medium text-[11px]';
        tempBadgeEl.textContent = `🌡️ Suhu Hangat (${temp.toFixed(1)}°C) - Nyalakan Pendingin`;
      } else if (temp < 21) {
        tempBadgeEl.className = 'px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300 font-medium text-[11px]';
        tempBadgeEl.textContent = `❄️ Suhu Sejuk (${temp.toFixed(1)}°C)`;
      } else {
        tempBadgeEl.className = 'px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-medium text-[11px]';
        tempBadgeEl.textContent = `🌡️ Suhu Nyaman (${temp.toFixed(1)}°C)`;
      }
    } else {
      tempBadgeEl.className = 'px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-medium text-[11px]';
      tempBadgeEl.textContent = `🌡️ Suhu: --`;
    }
  }

  if (humBadgeEl) {
    if (humidity !== null) {
      if (humidity > 70) {
        humBadgeEl.className = 'px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300 font-medium text-[11px]';
        humBadgeEl.textContent = `💧 Kelembapan Tinggi (${humidity.toFixed(1)}%) - Jaga Sirkulasi`;
      } else if (humidity < 40) {
        humBadgeEl.className = 'px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-medium text-[11px]';
        humBadgeEl.textContent = `🌵 Udara Kering (${humidity.toFixed(1)}%) - Gunakan Humidifier`;
      } else {
        humBadgeEl.className = 'px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 border border-sky-300 font-medium text-[11px]';
        humBadgeEl.textContent = `💧 Kelembapan Ideal (${humidity.toFixed(1)}%)`;
      }
    } else {
      humBadgeEl.className = 'px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 font-medium text-[11px]';
      humBadgeEl.textContent = `💧 Kelembapan: --`;
    }
  }
}

/**
 * 7. Pembaruan DOM Elemen Utama Dashboard
 * Menampilkan '--' jika data/hardware belum ada
 */
function updateDashboardDOM(data) {
  const { ppm, temp, humidity, pm25, category, timestamp, hasHardware } = data;

  const ppmValueEl = document.getElementById('ppmValue');
  const statusBadgeEl = document.getElementById('statusBadge');
  const statusDescEl = document.getElementById('statusDescription');
  const mainCardEl = document.getElementById('mainStatusCard');
  const scalePointerEl = document.getElementById('scalePointer');
  const scaleTextEl = document.getElementById('scaleIndicatorText');

  // 1. PPM Gas Sensor
  if (ppmValueEl) {
    ppmValueEl.textContent = ppm !== null ? ppm : '--';
  }

  if (statusBadgeEl) {
    if (ppm !== null) {
      statusBadgeEl.className = `inline-flex items-center px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase border ${category.badgeClass}`;
      statusBadgeEl.innerHTML = `<i class="fa-solid ${category.icon} mr-1.5 text-[11px]"></i> ${category.label}`;
    } else {
      statusBadgeEl.className = `inline-flex items-center px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase border bg-slate-100 text-slate-600 border-slate-300`;
      statusBadgeEl.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-1.5 text-[11px]"></i> Menunggu Data`;
    }
  }

  if (statusDescEl) {
    statusDescEl.textContent = ppm !== null ? category.advice : 'Menunggu penerimaan sinyal data dari sensor ruangan...';
  }

  if (mainCardEl) {
    mainCardEl.classList.remove('glow-good', 'glow-moderate', 'glow-hazardous');
    if (ppm !== null) mainCardEl.classList.add(category.glowClass);
  }

  if (scalePointerEl) {
    scalePointerEl.style.left = ppm !== null ? `${category.scalePercent}%` : '5%';
  }
  if (scaleTextEl) {
    if (ppm !== null) {
      scaleTextEl.textContent = `Level: ${category.label}`;
      scaleTextEl.className = category.level === 'good' ? 'text-emerald-600 font-bold' : category.level === 'moderate' ? 'text-amber-600 font-bold' : 'text-rose-600 font-bold';
    } else {
      scaleTextEl.textContent = 'Menunggu Data';
      scaleTextEl.className = 'text-slate-400 font-medium';
    }
  }

  // 2. Suhu Ruangan
  const tempValueEl = document.getElementById('tempValue');
  const tempBarEl = document.getElementById('tempBar');
  const tempStatusEl = document.getElementById('tempStatus');
  if (tempValueEl) {
    tempValueEl.textContent = temp !== null ? temp.toFixed(1) : '--';
  }
  if (tempBarEl) {
    const tempPercent = temp !== null ? Math.min(100, Math.max(0, (temp / 50) * 100)) : 0;
    tempBarEl.style.width = `${tempPercent}%`;
  }
  if (tempStatusEl) {
    if (temp !== null) {
      tempStatusEl.textContent = temp < 20 ? 'Sejuk / Dingin' : temp <= 30 ? 'Suhu Nyaman' : 'Hangat / Panas';
      tempStatusEl.className = 'text-xs text-slate-500 mt-1 font-medium';
    } else {
      tempStatusEl.textContent = '--';
      tempStatusEl.className = 'text-xs text-slate-400 mt-1 font-medium';
    }
  }

  // 3. Kelembapan (Presisi desimal tanpa pembulatan)
  const humValueEl = document.getElementById('humidityValue');
  const humBarEl = document.getElementById('humidityBar');
  const humStatusEl = document.getElementById('humidityStatus');
  if (humValueEl) {
    humValueEl.textContent = humidity !== null ? humidity.toFixed(1) : '--';
  }
  if (humBarEl) {
    humBarEl.style.width = humidity !== null ? `${Math.min(100, Math.max(0, humidity))}%` : '0%';
  }
  if (humStatusEl) {
    if (humidity !== null) {
      humStatusEl.textContent = humidity < 40 ? 'Udara Kering' : humidity <= 70 ? 'Kelembapan Ideal' : 'Sangat Lembap';
      humStatusEl.className = 'text-xs text-slate-500 mt-1 font-medium';
    } else {
      humStatusEl.textContent = '--';
      humStatusEl.className = 'text-xs text-slate-400 mt-1 font-medium';
    }
  }

  // 4. PM2.5 (Jika hardware belum ada, tampilkan '--' dan status 'Sensor belum terpasang')
  const pm25ValueEl = document.getElementById('pm25Value');
  const pm25BarEl = document.getElementById('pm25Bar');
  const pm25StatusEl = document.getElementById('pm25Status');
  if (pm25ValueEl) {
    pm25ValueEl.textContent = pm25 !== null ? pm25.toFixed(1) : '--';
  }
  if (pm25BarEl) {
    const pmPercent = pm25 !== null ? Math.min(100, Math.max(0, (pm25 / 100) * 100)) : 0;
    pm25BarEl.style.width = `${pmPercent}%`;
  }
  if (pm25StatusEl) {
    if (pm25 !== null) {
      if (pm25 <= THRESHOLDS.PM25_GOOD_MAX) {
        pm25StatusEl.textContent = 'Partikel Rendah (Baik)';
        pm25StatusEl.className = 'text-xs text-emerald-600 mt-1 font-semibold';
      } else if (pm25 <= THRESHOLDS.PM25_MODERATE_MAX) {
        pm25StatusEl.textContent = 'Partikel Sedang';
        pm25StatusEl.className = 'text-xs text-amber-600 mt-1 font-semibold';
      } else {
        pm25StatusEl.textContent = 'Partikel Tinggi (Bahaya)';
        pm25StatusEl.className = 'text-xs text-rose-600 mt-1 font-semibold';
      }
    } else {
      pm25StatusEl.textContent = 'Sensor belum terpasang';
      pm25StatusEl.className = 'text-xs text-slate-400 mt-1 font-medium';
    }
  }

  // 5. Kategori ISPU / Kategori Udara
  const ispuCatEl = document.getElementById('ispuCategory');
  const ispuRecEl = document.getElementById('ispuRecommendation');
  const ispuBarEl = document.getElementById('ispuBar');
  if (ispuCatEl) {
    if (ppm !== null) {
      ispuCatEl.textContent = category.ispu;
      ispuCatEl.className = `text-2xl sm:text-3xl font-extrabold tracking-tight ${category.level === 'good' ? 'text-emerald-600' : category.level === 'moderate' ? 'text-amber-600' : 'text-rose-600'}`;
    } else {
      ispuCatEl.textContent = '--';
      ispuCatEl.className = 'text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-400';
    }
  }
  if (ispuRecEl) {
    if (ppm !== null) {
      ispuRecEl.textContent = category.level === 'good' ? 'Aman untuk semua orang' : category.level === 'moderate' ? 'Sensitif harap waspada' : 'Bahaya! Lindungi pernapasan';
    } else {
      ispuRecEl.textContent = 'Menunggu data...';
    }
  }
  if (ispuBarEl) {
    ispuBarEl.style.width = ppm !== null ? `${category.scalePercent}%` : '0%';
    ispuBarEl.className = `h-2 rounded-full transition-all duration-700 ${category.level === 'good' ? 'bg-emerald-500' : category.level === 'moderate' ? 'bg-amber-500' : 'bg-rose-500'}`;
  }

  // 6. Waktu Terakhir Diperbarui
  const lastUpdateEl = document.getElementById('lastUpdateTimestamp');
  if (lastUpdateEl) {
    const dateObj = new Date(timestamp);
    lastUpdateEl.textContent = dateObj.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }) + ' WIB';
  }
}

/**
 * 8. Menyimpan Riwayat Lokal untuk Grafik & Tabel
 */
function appendToLocalHistory(reading) {
  AppState.historyData.push(reading);
  if (AppState.historyData.length > AppState.maxHistoryPoints) {
    AppState.historyData.shift();
  }
  updateChartData();
  renderHistoryTable();
}

/**
 * ============================================================================
 * 9. STATUS KONEKSI: ICON ONLY WIFI & WIFI TERCORET (TANPA LABEL TEKS)
 * ============================================================================
 */
function setDeviceStatus(state) {
  const container = document.getElementById('deviceWifiContainer');
  const slot = document.getElementById('wifiIconSlot');
  const drawerStatus = document.getElementById('drawerDeviceStatus');

  if (!container || !slot) return;

  // SVG Icon Wifi Terhubung
  const svgWifiConnected = `
    <svg class="w-5 h-5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
      <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
      <circle cx="12" cy="20" r="1" fill="currentColor"></circle>
    </svg>
  `;

  // SVG Icon Wifi Tercoret (Disconnected / Offline)
  const svgWifiDisconnected = `
    <svg class="w-5 h-5 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="2" y1="2" x2="22" y2="22"></line>
      <path d="M8.5 16.5a5 5 0 0 1 7 0"></path>
      <path d="M2 8.82a15 15 0 0 1 4.17-2.65"></path>
      <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.82"></path>
      <path d="M16.85 11.25a10 10 0 0 1 2.22 1.3"></path>
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
      <circle cx="12" cy="20" r="1" fill="currentColor"></circle>
    </svg>
  `;

  // SVG Icon Wifi Menghubungkan (Pulsing)
  const svgWifiConnecting = `
    <svg class="w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
      <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
      <circle cx="12" cy="20" r="1" fill="currentColor"></circle>
    </svg>
  `;

  if (state === 'online') {
    container.className = 'w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 shadow-sm flex items-center justify-center transition-all cursor-pointer';
    container.title = 'Status Koneksi: Terhubung';
    slot.innerHTML = svgWifiConnected;
    if (drawerStatus) {
      drawerStatus.className = 'font-bold text-emerald-600 flex items-center gap-1.5';
      drawerStatus.innerHTML = '<i class="fa-solid fa-wifi text-xs"></i> Terhubung';
    }
  } else if (state === 'offline') {
    container.className = 'w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 shadow-sm flex items-center justify-center transition-all cursor-pointer';
    container.title = 'Status Koneksi: Terputus';
    slot.innerHTML = svgWifiDisconnected;
    if (drawerStatus) {
      drawerStatus.className = 'font-bold text-rose-500 flex items-center gap-1.5';
      drawerStatus.innerHTML = '<i class="fa-solid fa-slash text-xs"></i> Terputus';
    }
  } else {
    // connecting / waiting
    container.className = 'w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 shadow-sm flex items-center justify-center animate-pulse transition-all cursor-pointer';
    container.title = 'Status Koneksi: Menghubungkan...';
    slot.innerHTML = svgWifiConnecting;
    if (drawerStatus) {
      drawerStatus.className = 'font-bold text-amber-600 flex items-center gap-1.5 animate-pulse';
      drawerStatus.innerHTML = '<i class="fa-solid fa-wifi text-xs"></i> Menghubungkan';
    }
  }
}

/**
 * 10. Watchdog Timer Sinyal Sensor
 */
function startWatchdogTimer() {
  if (AppState.watchdogTimer) clearInterval(AppState.watchdogTimer);

  AppState.watchdogTimer = setInterval(() => {
    if (!AppState.lastPacketTime) return;

    const diffSeconds = Math.floor((Date.now() - AppState.lastPacketTime) / 1000);
    const countdownEl = document.getElementById('heartbeatCountdown');

    if (diffSeconds > AppState.offlineThresholdSeconds) {
      setDeviceStatus('offline');
      if (countdownEl) {
        countdownEl.innerHTML = `<span class="text-rose-600 font-semibold"><i class="fa-solid fa-triangle-exclamation"></i> Sinyal terputus sejak ${diffSeconds} detik</span>`;
      }
    } else {
      if (countdownEl) {
        countdownEl.innerHTML = `<span class="text-emerald-600 font-semibold"><i class="fa-solid fa-bolt"></i> Terhubung (${diffSeconds}s lalu)</span>`;
      }
    }
  }, 1000);
}

/**
 * ============================================================================
 * 11. INISIALISASI CHART.JS DENGAN DESAIN LIGHT & JELAS
 * ============================================================================
 */
function initChart() {
  const ctx = document.getElementById('airQualityChart');
  if (!ctx) return;

  const context2d = ctx.getContext('2d');

  // Gradien Transparan Halus untuk Area Bawah Grafik
  const gradientPPM = context2d.createLinearGradient(0, 0, 0, 280);
  gradientPPM.addColorStop(0, 'rgba(37, 99, 235, 0.22)');
  gradientPPM.addColorStop(0.65, 'rgba(37, 99, 235, 0.04)');
  gradientPPM.addColorStop(1, 'rgba(37, 99, 235, 0.00)');

  AppState.chartInstance = new Chart(context2d, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Kadar Gas PPM',
        data: [],
        borderColor: '#2563eb',
        backgroundColor: gradientPPM,
        borderWidth: 2.8,
        fill: true,
        tension: 0.38,
        pointBackgroundColor: '#2563eb',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 3.5,
        pointHoverRadius: 7,
        pointHoverBackgroundColor: '#2563eb',
        pointHoverBorderColor: 'rgba(37, 99, 235, 0.3)',
        pointHoverBorderWidth: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#334155',
            font: { family: 'Inter', size: 12, weight: '600' },
            boxWidth: 14,
            boxHeight: 14,
            usePointStyle: true,
          }
        },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.98)',
          titleColor: '#0f172a',
          bodyColor: '#334155',
          borderColor: '#e2e8f0',
          borderWidth: 1.5,
          padding: 12,
          boxPadding: 6,
          usePointStyle: true,
          titleFont: { family: 'Inter', weight: 'bold', size: 12 },
          bodyFont: { family: 'JetBrains Mono', size: 12 },
          callbacks: {
            label: function (context) {
              const val = context.parsed.y;
              const name = context.dataset.label || '';
              return ` ${name}: ${val !== null && val !== undefined ? val : '--'}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(226, 232, 240, 0.6)',
            drawTicks: false
          },
          ticks: {
            color: '#64748b',
            font: { family: 'Inter', size: 11 },
            maxRotation: 0
          }
        },
        y: {
          grid: {
            color: 'rgba(226, 232, 240, 0.7)'
          },
          ticks: {
            color: '#64748b',
            font: { family: 'Inter', size: 11 }
          },
          suggestedMin: 0
        }
      },
      animation: {
        duration: 350
      }
    }
  });
}

/**
 * 12. Update Data Grafik & Hitung Statistik Rata-rata, Puncak, Terendah
 */
function updateChartData() {
  if (!AppState.chartInstance || !AppState.historyData.length) return;

  const labels = AppState.historyData.map(item => {
    const d = new Date(item.timestamp);
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });

  const chart = AppState.chartInstance;
  const ctx = chart.ctx;

  if (AppState.activeChartTab === 'ppm') {
    // Gradien Transparan Biru untuk PPM
    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(37, 99, 235, 0.25)');
    gradient.addColorStop(0.65, 'rgba(37, 99, 235, 0.05)');
    gradient.addColorStop(1, 'rgba(37, 99, 235, 0.00)');

    chart.data.labels = labels;
    chart.data.datasets = [{
      label: 'Kadar Gas (PPM)',
      data: AppState.historyData.map(item => item.ppm !== null ? item.ppm : 0),
      borderColor: '#2563eb',
      backgroundColor: gradient,
      borderWidth: 2.8,
      fill: true,
      tension: 0.38,
      pointBackgroundColor: '#2563eb',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2,
      pointRadius: 3.5,
      pointHoverRadius: 7,
      pointHoverBackgroundColor: '#2563eb',
      pointHoverBorderColor: 'rgba(37, 99, 235, 0.3)',
      pointHoverBorderWidth: 6
    }];
    chart.options.scales.y.suggestedMax = 1000;

  } else if (AppState.activeChartTab === 'climate') {
    // Gradien Transparan Oranye untuk Suhu
    const gradientTemp = ctx.createLinearGradient(0, 0, 0, 280);
    gradientTemp.addColorStop(0, 'rgba(249, 115, 22, 0.22)');
    gradientTemp.addColorStop(0.65, 'rgba(249, 115, 22, 0.04)');
    gradientTemp.addColorStop(1, 'rgba(249, 115, 22, 0.00)');

    // Gradien Transparan Biru Muda untuk Kelembapan
    const gradientHum = ctx.createLinearGradient(0, 0, 0, 280);
    gradientHum.addColorStop(0, 'rgba(2, 132, 199, 0.22)');
    gradientHum.addColorStop(0.65, 'rgba(2, 132, 199, 0.04)');
    gradientHum.addColorStop(1, 'rgba(2, 132, 199, 0.00)');

    chart.data.labels = labels;
    chart.data.datasets = [
      {
        label: 'Suhu (°C)',
        data: AppState.historyData.map(item => item.temp !== null ? item.temp : null),
        borderColor: '#f97316',
        backgroundColor: gradientTemp,
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#f97316',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 3.5,
        pointHoverRadius: 7,
        pointHoverBackgroundColor: '#f97316',
        pointHoverBorderColor: 'rgba(249, 115, 22, 0.3)',
        pointHoverBorderWidth: 6,
        yAxisID: 'y'
      },
      {
        label: 'Kelembapan (%)',
        data: AppState.historyData.map(item => item.humidity !== null ? item.humidity : null),
        borderColor: '#0284c7',
        backgroundColor: gradientHum,
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#0284c7',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 3.5,
        pointHoverRadius: 7,
        pointHoverBackgroundColor: '#0284c7',
        pointHoverBorderColor: 'rgba(2, 132, 199, 0.3)',
        pointHoverBorderWidth: 6,
        yAxisID: 'y'
      }
    ];
    chart.options.scales.y.suggestedMax = 100;

  } else if (AppState.activeChartTab === 'pm25') {
    const hasAnyPm25 = AppState.historyData.some(i => i.pm25 !== null && i.pm25 !== undefined);

    // Gradien Transparan Indigo untuk PM2.5
    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.22)');
    gradient.addColorStop(0.65, 'rgba(99, 102, 241, 0.04)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.00)');

    chart.data.labels = labels;
    chart.data.datasets = [{
      label: hasAnyPm25 ? 'Partikel PM2.5 (µg/m³)' : 'PM2.5 (Sensor belum terpasang)',
      data: AppState.historyData.map(item => item.pm25 !== null ? item.pm25 : null),
      borderColor: '#6366f1',
      backgroundColor: gradient,
      borderWidth: 2.8,
      fill: true,
      tension: 0.38,
      pointBackgroundColor: '#6366f1',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2,
      pointRadius: 3.5,
      pointHoverRadius: 7,
      pointHoverBackgroundColor: '#6366f1',
      pointHoverBorderColor: 'rgba(99, 102, 241, 0.3)',
      pointHoverBorderWidth: 6
    }];
    chart.options.scales.y.suggestedMax = 80;
  }

  chart.update('none');

  const countEl = document.getElementById('chartDataPointsCount');
  if (countEl) countEl.textContent = `${AppState.historyData.length} data points`;

  updateChartStats();
}

/**
 * 13. Hitung & Tampilkan Statistik Ringkasan (Avg, Max, Min, Trend)
 */
function updateChartStats() {
  if (!AppState.historyData || !AppState.historyData.length) return;

  const statAvgEl = document.getElementById('chartStatAvg');
  const statMaxEl = document.getElementById('chartStatMax');
  const statMinEl = document.getElementById('chartStatMin');
  const statTrendEl = document.getElementById('chartStatTrend');

  let rawValues = [];
  let unit = '';

  if (AppState.activeChartTab === 'ppm') {
    rawValues = AppState.historyData.map(i => i.ppm);
    unit = ' PPM';
  } else if (AppState.activeChartTab === 'climate') {
    rawValues = AppState.historyData.map(i => i.temp);
    unit = '°C';
  } else if (AppState.activeChartTab === 'pm25') {
    rawValues = AppState.historyData.map(i => i.pm25);
    unit = ' µg/m³';
  }

  // Filter nilai null (hardware tidak ada)
  const validValues = rawValues.filter(v => v !== null && v !== undefined && !isNaN(v));

  if (!validValues.length) {
    if (statAvgEl) statAvgEl.textContent = '--';
    if (statMaxEl) statMaxEl.textContent = '--';
    if (statMinEl) statMinEl.textContent = '--';
    if (statTrendEl) {
      statTrendEl.innerHTML = AppState.activeChartTab === 'pm25'
        ? '<span class="text-slate-400">Sensor belum terpasang</span>'
        : '<span class="text-slate-400">Belum ada data</span>';
    }
    return;
  }

  const sum = validValues.reduce((acc, curr) => acc + curr, 0);
  const avg = (sum / validValues.length).toFixed(1);
  const max = Math.max(...validValues).toFixed(1);
  const min = Math.min(...validValues).toFixed(1);

  if (statAvgEl) statAvgEl.textContent = `${avg}${unit}`;
  if (statMaxEl) statMaxEl.textContent = `${max}${unit}`;
  if (statMinEl) statMinEl.textContent = `${min}${unit}`;

  // Analisis Tren
  if (statTrendEl) {
    if (validValues.length >= 4) {
      const half = Math.floor(validValues.length / 2);
      const firstHalf = validValues.slice(0, half);
      const secondHalf = validValues.slice(half);

      const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      const diff = avg2 - avg1;
      const threshold = avg1 * 0.03;

      if (diff > threshold) {
        statTrendEl.innerHTML = `<span class="text-rose-600 flex items-center gap-1"><i class="fa-solid fa-arrow-trend-up"></i> Meningkat (${Math.round((diff / avg1) * 100)}%)</span>`;
      } else if (diff < -threshold) {
        statTrendEl.innerHTML = `<span class="text-emerald-600 flex items-center gap-1"><i class="fa-solid fa-arrow-trend-down"></i> Menurun (${Math.round(Math.abs(diff / avg1) * 100)}%)</span>`;
      } else {
        statTrendEl.innerHTML = `<span class="text-blue-700 flex items-center gap-1"><i class="fa-solid fa-arrow-right"></i> Stabil</span>`;
      }
    } else {
      statTrendEl.innerHTML = `<span class="text-slate-500">Menganalisis tren...</span>`;
    }
  }
}

/**
 * 14. Render Tabel Catatan Riwayat Data
 */
function renderHistoryTable() {
  const tbody = document.getElementById('historyTableBody');
  const countText = document.getElementById('logCountText');
  if (!tbody) return;

  if (!AppState.historyData.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400 font-sans">Belum ada riwayat data yang masuk. Menunggu sinyal sensor...</td></tr>`;
    return;
  }

  const reversedLogs = [...AppState.historyData].reverse().slice(0, 8);
  if (countText) countText.textContent = `${reversedLogs.length} data terbaru`;

  tbody.innerHTML = reversedLogs.map((log) => {
    const timeStr = new Date(log.timestamp).toLocaleTimeString('id-ID', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const isGood = log.ppm !== null ? log.ppm <= THRESHOLDS.GOOD_MAX : true;
    const isModerate = log.ppm !== null && log.ppm > THRESHOLDS.GOOD_MAX && log.ppm <= THRESHOLDS.MODERATE_MAX;
    const badgeColor = isGood
      ? 'text-emerald-700 bg-emerald-50 border-emerald-300'
      : isModerate
        ? 'text-amber-800 bg-amber-50 border-amber-300'
        : 'text-rose-700 bg-rose-50 border-rose-300';

    return `
      <tr class="hover:bg-blue-50/40 transition">
        <td class="py-2.5 px-3.5 text-slate-500 text-xs">${timeStr}</td>
        <td class="py-2.5 px-3.5 font-bold text-slate-900">${log.ppm !== null ? `${log.ppm} <span class="text-[10px] text-slate-400 font-normal">PPM</span>` : '<span class="text-slate-400">--</span>'}</td>
        <td class="py-2.5 px-3.5 text-slate-700">${log.temp !== null ? `${log.temp.toFixed(1)}°C` : '<span class="text-slate-400">--</span>'}</td>
        <td class="py-2.5 px-3.5 text-slate-700">${log.humidity !== null ? `${log.humidity.toFixed(1)}%` : '<span class="text-slate-400">--</span>'}</td>
        <td class="py-2.5 px-3.5 text-slate-700">${log.pm25 !== null ? log.pm25.toFixed(1) : '<span class="text-slate-400">--</span>'}</td>
        <td class="py-2.5 px-3.5 text-right">
          <span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badgeColor}">
            ${log.status || 'BAIK'}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * 15. Event Listener Tombol Navigasi & Tab Chart
 */
function initDOMListeners() {
  const tabPPM = document.getElementById('chartTabPPM');
  const tabClimate = document.getElementById('chartTabClimate');
  const tabPM25 = document.getElementById('chartTabPM25');

  const setTabActive = (activeBtn, tabName) => {
    [tabPPM, tabClimate, tabPM25].forEach(btn => {
      if (!btn) return;
      btn.className = 'px-3.5 py-1.5 rounded-lg font-medium transition text-slate-600 hover:text-blue-600';
    });
    activeBtn.className = 'px-3.5 py-1.5 rounded-lg font-bold transition text-white bg-blue-600 shadow-sm';
    AppState.activeChartTab = tabName;
    updateChartData();
  };

  if (tabPPM) tabPPM.addEventListener('click', () => setTabActive(tabPPM, 'ppm'));
  if (tabClimate) tabClimate.addEventListener('click', () => setTabActive(tabClimate, 'climate'));
  if (tabPM25) tabPM25.addEventListener('click', () => setTabActive(tabPM25, 'pm25'));

  const btnCloseNotice = document.getElementById('btnCloseNotice');
  if (btnCloseNotice) {
    btnCloseNotice.addEventListener('click', () => {
      document.getElementById('noticeBanner').classList.add('hidden');
    });
  }

  const btnToggleDemo = document.getElementById('btnToggleDemo');
  if (btnToggleDemo) {
    btnToggleDemo.addEventListener('click', toggleDemoMode);
  }
}

/**
 * 16. Toggle Mode Simulasi Demo
 */
function toggleDemoMode() {
  const noticeBanner = document.getElementById('noticeBanner');
  if (AppState.isDemoMode) {
    clearInterval(AppState.demoTimer);
    AppState.isDemoMode = false;
    if (noticeBanner) noticeBanner.classList.add('hidden');
    setDeviceStatus('connecting');
    // Sinkronisasi ulang dengan data asli
    initFirebase();
  } else {
    if (noticeBanner) noticeBanner.classList.remove('hidden');
    startDemoSimulation();
  }
}

/**
 * 17. Mode Simulasi Demo Interaktif (Hanya jika tombol simulasi diklik)
 */
function startDemoSimulation() {
  if (AppState.demoTimer) clearInterval(AppState.demoTimer);
  AppState.isDemoMode = true;

  setDeviceStatus('online');

  let currentPpm = 380;
  let currentTemp = 28.2;
  let currentHum = 64;

  const generateTick = () => {
    const deltaPpm = (Math.random() - 0.48) * 45;
    currentPpm = Math.max(120, Math.min(1250, Math.round(currentPpm + deltaPpm)));

    const deltaTemp = (Math.random() - 0.5) * 0.4;
    currentTemp = Math.round((currentTemp + deltaTemp) * 10) / 10;

    const deltaHum = (Math.random() - 0.5) * 1.5;
    currentHum = Math.max(30, Math.min(95, Math.round((currentHum + deltaHum) * 10) / 10));

    const dummyPayload = {
      ppm: currentPpm,
      temp: currentTemp,
      humidity: currentHum,
      status: currentPpm <= THRESHOLDS.GOOD_MAX ? "Baik" : currentPpm <= THRESHOLDS.MODERATE_MAX ? "Sedang" : "Berbahaya",
      timestamp: Math.floor(Date.now() / 1000)
    };

    processIncomingData(dummyPayload, 'demo');
  };

  if (AppState.historyData.length < 5) {
    for (let i = 8; i >= 1; i--) {
      const historicalTime = Date.now() - (i * 3000);
      const mockPpm = Math.floor(340 + Math.random() * 90);
      processIncomingData({
        ppm: mockPpm,
        temp: 27.5 + Math.random() * 2,
        humidity: 58 + Math.random() * 8,
        timestamp: historicalTime
      }, 'demo_seed');
    }
  }

  AppState.demoTimer = setInterval(generateTick, 3000);
}
