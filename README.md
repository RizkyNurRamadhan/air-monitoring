# 🍃 AeroSense IoT - Air Quality Monitoring Dashboard

Dashboard web pemantau kualitas udara realtime berbasis IoT yang dirancang untuk dihosting secara gratis di **Vercel** dan terhubung langsung ke **Firebase Realtime Database**. Cocok untuk diakses melalui smartphone (misal pemindaian kode QR di lokasi sensor).

---

## 📋 Fitur Utama
1. **Mobile-First & Modern UI**: Tampilan responsif, dark mode elegan dengan Tailwind CSS, sangat ramah layar smartphone.
2. **Sinkronisasi Realtime**: Terhubung langsung ke Firebase Realtime Database dengan latensi di bawah 1 detik.
3. **Kartu Metrik & Indikator Sensor**:
   - Konsentrasi Gas MQ-135 (PPM) dengan visualisasi bar skala ISPU.
   - Suhu (°C) & Kelembapan Relatif (%).
   - Estimasi Partikel Debu PM2.5 (µg/m³).
4. **Status Badge Dinamis**:
   - 🟢 **Baik** (0 – 500 PPM): Udara segar, sehat, aman beraktivitas.
   - 🟡 **Sedang** (501 – 1000 PPM): Perlu kewaspadaan untuk kelompok sensitif.
   - 🔴 **Berbahaya** (> 1000 PPM): Indikasi asap atau kebocoran gas polutan tinggi.
5. **Indikator Koneksi ESP32 & Heartbeat Watchdog**:
   - Menghitung selisih waktu paket data terakhir.
   - Otomatis mengubah status menjadi **Offline** jika data tidak masuk lebih dari 30 detik.
6. **Live Streaming Chart (Chart.js)**:
   - Menampilkan tren 20 titik data pembacaan sensor terakhir secara halus tanpa lag.
   - Tab pemilih dataset: *Kadar Gas (PPM)*, *Suhu & Lembap*, dan *PM2.5*.
7. **Mode Simulasi Built-in**: Dashboard langsung menyala dengan simulasi data otomatis sebelum Firebase atau ESP32 dipasang.

---

## 📂 Struktur Berkas Proyek

```text
├── index.html     # Antarmuka UI lengkap (Tailwind CSS, Chart.js, Firebase SDK via CDN)
├── app.js         # Logika Firebase, manipulasi DOM, watchdog offline, dan Chart streaming
├── vercel.json    # Konfigurasi deployment static hosting dan security headers di Vercel
└── README.md      # Panduan setup Firebase, contoh kode ESP32, dan deploy ke Vercel
```

---

## 🛠️ Langkah 1: Konfigurasi Firebase Realtime Database

### 1. Buat Firebase Project
1. Buka [Firebase Console](https://console.firebase.google.com/).
2. Klik **Add project** (Tambah project) dan beri nama, misalnya `esp32-air-quality`.
3. Nonaktifkan Google Analytics (opsional), lalu klik **Create project**.

### 2. Aktifkan Realtime Database
1. Di bilah menu sebelah kiri, buka **Build** &rarr; **Realtime Database**.
2. Klik tombol **Create Database**.
3. Pilih lokasi server terdekat, disarankan: **Singapore (`asia-southeast1`)** atau **United States**.
4. Pilih **Start in test mode** untuk pengujian awal.

### 3. Konfigurasi Aturan Akses (Security Rules)
Buka tab **Rules** pada Realtime Database, lalu masukkan aturan berikut agar Web Dashboard dapat membaca data secara publik dan ESP32 dapat menulis data:

```json
{
  "rules": {
    "air_quality": {
      ".read": true,
      ".write": true
    }
  }
}
```
> 💡 *Catatan:* Untuk produksi skala luas, Anda dapat menggunakan Firebase Authentication atau Database Secrets untuk mengamankan hak akses penulisan.

### 4. Dapatkan Kredensial Web App Firebase
1. Buka **Project Settings** (ikon gerigi di samping menu Project Overview).
2. Di tab **General**, gulir ke bawah ke bagian **Your apps**, lalu klik ikon Web (`</>`).
3. Beri nama aplikasi (misal: `air-quality-web`), lalu klik **Register app**.
4. Salin objek `firebaseConfig`.

### 5. Masukkan ke `app.js`
Buka berkas [app.js](file:///D:/Other/web-air-quality/app.js) dan ganti nilai variabel `firebaseConfig`:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyD-CONTOH_API_KEY_ANDA",
  authDomain: "esp32-air-quality.firebaseapp.com",
  databaseURL: "https://esp32-air-quality-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "esp32-air-quality",
  storageBucket: "esp32-air-quality.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```

---

## 📡 Langkah 2: Format Data & Contoh Program ESP32

Dashboard memantau path: `/air_quality/live`.

### Format JSON yang Dikirim ESP32:
```json
{
  "ppm": 450,
  "temp": 28.5,
  "humidity": 65,
  "status": "Baik",
  "pm25": 14.5,
  "timestamp": 1774431000
}
```

### Contoh Kode Arduino IDE untuk ESP32 (Menggunakan HTTP REST):
Metode ini sangat stabil, ringan, dan tidak memerlukan pustaka Firebase yang rumit:

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>

// 1. Konfigurasi Wi-Fi
const char* WIFI_SSID = "NAMA_WIFI_ANDA";
const char* WIFI_PASS = "PASSWORD_WIFI_ANDA";

// 2. URL Firebase Realtime Database
// Ganti dengan databaseURL Anda (pastikan diakhiri dengan /air_quality/live.json)
const char* FIREBASE_URL = "https://esp32-air-quality-default-rtdb.asia-southeast1.firebasedatabase.app/air_quality/live.json";

// 3. Pin Sensor
#define PIN_MQ135 34
#define PIN_DHT 4
#define DHTTYPE DHT22

DHT dht(PIN_DHT, DHTTYPE);

void setup() {
  Serial.begin(115200);
  dht.begin();
  pinMode(PIN_MQ135, INPUT);

  Serial.print("Menghubungkan ke WiFi: ");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Terhubung! IP: " + WiFi.localIP().toString());
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    // Pembacaan sensor
    float temp = dht.readTemperature();
    float hum = dht.readHumidity();
    int rawGas = analogRead(PIN_MQ135);
    
    // Konversi sederhana ADC ke PPM estimasi (sesuaikan kalibrasi sensor Anda)
    int ppm = map(rawGas, 0, 4095, 100, 1500);
    if (isnan(temp)) temp = 28.0;
    if (isnan(hum)) hum = 65.0;

    String statusStr = (ppm <= 500) ? "Baik" : (ppm <= 1000) ? "Sedang" : "Berbahaya";

    // Format Payload JSON
    String jsonPayload = "{";
    jsonPayload += "\"ppm\":" + String(ppm) + ",";
    jsonPayload += "\"temp\":" + String(temp, 1) + ",";
    jsonPayload += "\"humidity\":" + String(hum, 0) + ",";
    jsonPayload += "\"status\":\"" + statusStr + "\",";
    jsonPayload += "\"timestamp\":" + String((unsigned long)(millis() / 1000));
    jsonPayload += "}";

    // Kirim data ke Firebase melalui HTTP PUT
    HTTPClient http;
    http.begin(FIREBASE_URL);
    http.addHeader("Content-Type", "application/json");
    
    int httpResponseCode = http.PUT(jsonPayload);
    
    if (httpResponseCode > 0) {
      Serial.printf("Data terkirim! HTTP [%d]: %s\n", httpResponseCode, jsonPayload.c_str());
    } else {
      Serial.printf("Gagal kirim data, HTTP Error: %s\n", http.errorToString(httpResponseCode).c_str());
    }
    http.end();
  } else {
    Serial.println("Koneksi WiFi terputus, mencoba rekoneksi...");
    WiFi.reconnect();
  }

  // Kirim data berkala setiap 5 detik (jauh lebih cepat dari batas 30s watchdog)
  delay(5000);
}
```

---

## 🚀 Langkah 3: Deploy ke Vercel

### Opsi A: Deploy Langsung via Vercel CLI (Paling Cepat)
1. Buka terminal di folder proyek ini:
   ```bash
   cd D:\Other\web-air-quality
   ```
2. Jalankan perintah:
   ```bash
   npx vercel
   ```
3. Ikuti panduan interaktif di terminal:
   - *Set up and deploy?* &rarr; Tekan **Y**
   - *Which scope?* &rarr; Pilih akun Vercel Anda
   - *Link to existing project?* &rarr; Tekan **N**
   - *What's your project's name?* &rarr; Ketik `air-quality-dashboard`
   - *In which directory is your code located?* &rarr; Tekan **Enter** (`./`)
4. Dalam hitungan detik, Anda akan mendapatkan URL produksi seperti:
   `https://air-quality-dashboard.vercel.app`

### Opsi B: Deploy via GitHub
1. Buat repositori baru di GitHub (misal: `air-quality-dashboard`).
2. Push seluruh file folder ini ke repositori Anda:
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit air quality dashboard"
   git branch -M main
   git remote add origin https://github.com/USERNAME/air-quality-dashboard.git
   git push -u origin main
   ```
3. Buka dashboard [Vercel](https://vercel.com/dashboard) &rarr; klik **Add New...** &rarr; **Project**.
4. Impor repositori GitHub tersebut.
5. Klik tombol **Deploy** (Pengaturan framework otomatis mengenali *Other/Static Site*).

---

## 💻 Pengujian Lokal di Komputer

Anda dapat langsung membuka file [index.html](file:///D:/Other/web-air-quality/index.html) di browser Anda atau menggunakan server lokal sederhana:

```bash
# Menggunakan npx serve
npx serve .

# Atau menggunakan Python
python -m http.server 3000
```
Buka browser di `http://localhost:3000`. Dashboard akan langsung menampilkan animasi grafik dan indikator sensor secara realtime!
