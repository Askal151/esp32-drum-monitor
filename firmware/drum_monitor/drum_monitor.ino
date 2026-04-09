/**
 * drum_monitor.ino — ESP32 Drum Monitor
 * Sensor : 8x Hall Effect
 *   ADS1015 @ 0x48 (ADDR=GND) — S1–S4 (A0–A3)
 *   ADS1115 @ 0x49 (ADDR=VDD) — S5–S8 (A0–A3)
 * Button NAV      : GPIO 26  — tekan untuk next sample
 * Button SEL      : GPIO 25  — tekan untuk simpan/confirm sample
 * Button BPMNAV   : GPIO 27  — tekan untuk pilih sensor BPM (S1→S2→...→S8→S1)
 * Potensio BPM    : GPIO 34  — putar untuk ubah BPM sensor dipilih (40–200 BPM)
 * Button PITCHNAV : GPIO 18  — tekan untuk pilih sensor Pitch (S1→S2→...→S8→S1)
 * Potensio Pitch  : GPIO 35  — putar untuk ubah Pitch sensor dipilih (-12..+12 semitone)
 *
 * CATATAN PIN:
 *   GPIO 25/26/27/18 = mendukung INPUT_PULLUP (active LOW)
 *   GPIO 34/35       = ADC1, input-only, untuk potensio
 *   I2C : SDA=21, SCL=22 (kongsi oleh kedua-dua ADS)
 *   ADS1015 ADDR pin → GND  (alamat 0x48) — GAIN_TWO, 1mV/count
 *   ADS1115 ADDR pin → VDD  (alamat 0x49) — GAIN_TWO, 0.0625mV/count
 *
 * Serial Output @ 115200:
 *   HALL8|adc1|dev1|led1|...|adc8|dev8|led8  (24 nilai)
 *   [BTN]NAV           — button NAV ditekan  (GPIO 26)
 *   [BTN]SEL           — button SEL ditekan  (GPIO 25)
 *   [BPMCTRL]sel|bpm   — BPM semasa (setiap 100ms), sel=0–7
 *   [PITCHCTRL]sel|pitch — Pitch semasa (setiap 100ms), sel=0–7, pitch=-12..+12
 *
 * Threshold:
 *   S1–S4 (ADS1015, 12-bit): level 1 = 40 counts (~80mV)
 *   S5–S8 (ADS1115, 16-bit): level 1 = 640 counts (~80mV, ×16)
 */

#include <Wire.h>
#include <Adafruit_ADS1X15.h>

// ── ADS chips ──────────────────────────────────────────────────
Adafruit_ADS1015 ads1;   // 0x48 — S1–S4
Adafruit_ADS1115 ads2;   // 0x49 — S5–S8

// ── Baca ADC mengikut indeks sensor ────────────────────────────
inline int16_t readSensor(int s) {
  if (s < 4) return ads1.readADC_SingleEnded(s);
  else       return ads2.readADC_SingleEnded(s - 4);
}

// ── Pin Button (active LOW, internal pull-up) ──────────────────
#define BTN_NAV      26
#define BTN_SEL      25
#define BTN_BPMNAV   27   // Button pilih sensor BPM
#define BTN_PITCHNAV 18   // Button pilih sensor Pitch

// ── Pin Potensio ───────────────────────────────────────────────
#define POT_BPM    34   // ADC1 CH6, input-only
#define POT_PITCH  35   // ADC1 CH7, input-only

// ── Sensor config ──────────────────────────────────────────────
#define NUM_SENSORS          8
#define SAMPLES_BASELINE     50         // 50 sample × 3ms = 150ms per sensor, cukup untuk median
#define DEBOUNCE_MS          80
#define BASELINE_INTERVAL_MS 5000UL     // 5 saat — auto-recal lebih kerap

// Output ke serial tiap 20ms (50Hz), baca sensor tiap 2ms (500Hz)
#define SERIAL_INTERVAL_MS   20
#define SAMPLE_INTERVAL_MS   2

// S1–S4: ADS1015 (1mV/count @ GAIN_TWO) — minimum threshold
// S5–S8: ADS1115 (0.0625mV/count @ GAIN_TWO) — minimum threshold
// Threshold dioptimakan: L1 diturunkan untuk sensitifitas lebih baik
// ADS1015 (S1–S4): 2mV/count  → L1=50mV, L2=100mV, L3=200mV, L4=400mV
// ADS1115 (S5–S8): 0.125mV/count → ×16 dari S1–S4
// Full power — threshold paling rendah selamat (noise floor S1-S4 ≈ ±3 count)
// EMA alpha=0.7 sudah tapis noise, IDLE_CONFIRM=4 tahan signal
int thresh[NUM_SENSORS][4] = {
  {12,   30,   70,   140},    // S1  (24 / 60 / 140 / 280 mV)
  {12,   30,   70,   140},    // S2
  {12,   30,   70,   140},    // S3
  {12,   30,   70,   140},    // S4
  {200,  480,  1100, 2200},   // S5  (25 / 60 / 137 / 275 mV)
  {200,  480,  1100, 2200},   // S6
  {200,  480,  1100, 2200},   // S7
  {200,  480,  1100, 2200},   // S8
};

int16_t baseline[NUM_SENSORS] = {0};
bool    baselineDone           = false;
unsigned long lastBaselineTime = 0;

// ── EMA filter + adaptive baseline ────────────────────────────
// EMA halus spike noise jangka pendek; adaptive baseline koreksi drift perlahan
float emaAdc[NUM_SENSORS];        // ADC selepas EMA filter
float fBaseline[NUM_SENSORS];     // baseline float untuk adaptive correction
// alpha lebih besar = respons lebih pantas, atenuasi kurang
// S8 (ADS1115 A3) lebih noise — alpha lebih kecil
const float EMA_ALPHA_ARR[NUM_SENSORS] = {
  0.70f, 0.70f, 0.70f, 0.70f,   // S1–S4 (alpha 0.7 → ~3ms, tangkap hit singkat)
  0.70f, 0.70f, 0.70f, 0.20f    // S5–S7, S8 (alpha 0.2 → ~10ms, lebih stabil)
};
#define BASE_ADAPT 0.002f         // drift correction ~1 second time constant

// ── Hysteresis counter ────────────────────────────────────────
// HIT_CONFIRM  = 1 frame (20ms)  — ON cepat, tangkap hit singkat
// IDLE_CONFIRM = 4 frame (80ms)  — OFF lambat, tahan signal semasa hit
uint8_t hitConfirm[NUM_SENSORS] = {0};
uint8_t idleConfirm[NUM_SENSORS] = {0};
int     ledState[NUM_SENSORS]    = {0};
#define HIT_CONFIRM  1
#define IDLE_CONFIRM 4

// ── Debounce state ─────────────────────────────────────────────
bool          prevBtnNav      = HIGH;
bool          prevBtnSel      = HIGH;
bool          prevBtnBpmNav   = HIGH;
bool          prevBtnPitchNav = HIGH;
unsigned long lastNavTime      = 0;
unsigned long lastSelTime      = 0;
unsigned long lastBpmNavTime   = 0;
unsigned long lastPitchNavTime = 0;

// ── BPM control state ──────────────────────────────────────────
int           bpmSel                    = 0;   // Sensor yang dipilih untuk BPM (0–7)
int           sensorBpmArr[NUM_SENSORS];       // BPM tersimpan per sensor
int           potBpmPrev                = -1;  // Bacaan pot terakhir — detect pergerakan

// ── Pitch control state ────────────────────────────────────────
int           pitchSel                    = 0;   // Sensor yang dipilih untuk Pitch (0–7)
int           sensorPitchArr[NUM_SENSORS];       // Pitch tersimpan per sensor (-12..+12)
int           potPitchPrev                = -99; // Bacaan pot terakhir — detect pergerakan

// ── Timing ────────────────────────────────────────────────────
unsigned long lastSampleTime   = 0;
unsigned long lastSerialTime   = 0;
unsigned long lastBpmSendTime  = 0;
unsigned long lastPitchSendTime = 0;
#define BPM_SEND_INTERVAL_MS   100    // Hantar [BPMCTRL] setiap 100ms
#define PITCH_SEND_INTERVAL_MS 100    // Hantar [PITCHCTRL] setiap 100ms

// ── Setup ──────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(BTN_NAV,      INPUT_PULLUP);
  pinMode(BTN_SEL,      INPUT_PULLUP);
  pinMode(BTN_BPMNAV,   INPUT_PULLUP);
  pinMode(BTN_PITCHNAV, INPUT_PULLUP);

  Wire.begin();

  // Tunggu sensor stabil — jauhkan semua magnet sebelum kalibrasi
  Serial.println("[BOOT] Tunggu sensor stabil (2 saat)... JAUHKAN SEMUA MAGNET!");
  delay(2000);

  // ADS1015 @ 0x48
  if (!ads1.begin(0x48)) {
    Serial.println("[ERR] ADS1015 (0x48) tidak ditemui!");
    while (1) delay(500);
  }
  ads1.setGain(GAIN_TWO);   // ±2.048V — 1mV/count, 2× lebih sensitif
  ads1.setDataRate(RATE_ADS1015_1600SPS);  // 3300→1600 kurangkan noise antara channel

  // ADS1115 @ 0x49
  if (!ads2.begin(0x49)) {
    Serial.println("[ERR] ADS1115 (0x49) tidak ditemui!");
    while (1) delay(500);
  }
  ads2.setGain(GAIN_TWO);   // ±2.048V — 0.0625mV/count, 2× lebih sensitif
  ads2.setDataRate(RATE_ADS1115_860SPS);

  calibrateBaseline();

  // Init BPM per sensor (120 BPM default)
  for (int i = 0; i < NUM_SENSORS; i++) sensorBpmArr[i] = 120;
  potBpmPrev = readBpm();   // rekod posisi awal pot tanpa update sensorBpmArr

  // Init Pitch per sensor (0 semitone default)
  for (int i = 0; i < NUM_SENSORS; i++) sensorPitchArr[i] = 0;
  potPitchPrev = readPitch();   // rekod posisi awal pot tanpa update sensorPitchArr

  for (int s = 0; s < NUM_SENSORS; s++) {
    Serial.printf("[THRESH%d] %d|%d|%d|%d\n", s+1,
      thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3]);
  }

  Serial.printf("[DEBUG] NAV=%d SEL=%d BPMNAV=%d POT=%d PITCHNAV=%d PITCHPOT=%d\n",
    digitalRead(BTN_NAV), digitalRead(BTN_SEL),
    digitalRead(BTN_BPMNAV), analogRead(POT_BPM),
    digitalRead(BTN_PITCHNAV), analogRead(POT_PITCH));
  Serial.println("[READY]");
  // Hantar state awal supaya frontend tahu nilai sensor 0
  Serial.printf("[BPMCTRL]%d|%d\n", bpmSel, sensorBpmArr[bpmSel]);
  Serial.printf("[PITCHCTRL]%d|%d\n", pitchSel, sensorPitchArr[pitchSel]);
}

// ── Sort helper untuk median ────────────────────────────────────
void sortArr(int16_t* arr, int n) {
  for (int i = 0; i < n-1; i++)
    for (int j = i+1; j < n; j++)
      if (arr[j] < arr[i]) { int16_t t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
}

// ── Calibrate satu sensor (median 50 sample) ──────────────────
void calibrateOne(int s) {
  int16_t buf[SAMPLES_BASELINE];
  for (int n = 0; n < SAMPLES_BASELINE; n++) { buf[n] = readSensor(s); delay(3); }
  sortArr(buf, SAMPLES_BASELINE);
  baseline[s]  = buf[SAMPLES_BASELINE / 2];
  emaAdc[s]    = (float)baseline[s];
  fBaseline[s] = (float)baseline[s];
  hitConfirm[s] = 0; idleConfirm[s] = 0; ledState[s] = 0;
  Serial.printf("[INIT S%d] baseline=%d\n", s+1, baseline[s]);
}

// ── Calibrate baseline dengan validate + retry ─────────────────
// Selepas ambil baseline, semak semua sensor stabil.
// Jika ada sensor tidak stabil (magnet terlalu dekat), recal semula.
void calibrateBaseline() {
  Serial.println("[CAL] Kalibrasi semua sensor...");
  for (int s = 0; s < NUM_SENSORS; s++) calibrateOne(s);

  // Validate — bagi EMA masa settle, kemudian semak devasi
  for (int retry = 0; retry < 3; retry++) {
    delay(400);
    bool allStable = true;
    for (int s = 0; s < NUM_SENSORS; s++) {
      int16_t v   = readSensor(s);
      int16_t dev = v - baseline[s];
      if (abs(dev) > thresh[s][0]) {
        Serial.printf("[CAL] S%d tidak stabil (dev=%d) — recal...\n", s+1, dev);
        delay(300);
        calibrateOne(s);
        allStable = false;
      }
    }
    if (allStable) { Serial.println("[CAL] Semua sensor stabil."); break; }
    if (retry == 2) Serial.println("[CAL] Amaran: ada sensor mungkin masih tidak stabil.");
  }

  baselineDone = true;
  lastBaselineTime = millis();
  Serial.println("[CAL] Selesai.");
}

// ── Compute LED level ──────────────────────────────────────────
int computeLed(int sIdx, int16_t dev) {
  for (int lv = 3; lv >= 0; lv--)
    if (abs(dev) >= thresh[sIdx][lv]) return lv + 1;
  return 0;
}

// ── Baca potensio → BPM (40–200) dengan averaging untuk kurang noise ─
int readBpm() {
  long sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(POT_BPM);
  return map(sum / 16, 0, 4095, 40, 200);
}

// ── Baca potensio → Pitch (-12..+12 semitone) dengan averaging ─
int readPitch() {
  long sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(POT_PITCH);
  return map(sum / 16, 0, 4095, -12, 12);
}

// ── Poll buttons (non-blocking debounce) ──────────────────────
void pollButtons() {
  unsigned long now = millis();

  bool nav = digitalRead(BTN_NAV);
  if (prevBtnNav == HIGH && nav == LOW && now - lastNavTime > DEBOUNCE_MS) {
    lastNavTime = now;
    Serial.println("[BTN]NAV");
  }
  prevBtnNav = nav;

  bool sel = digitalRead(BTN_SEL);
  if (prevBtnSel == HIGH && sel == LOW && now - lastSelTime > DEBOUNCE_MS) {
    lastSelTime = now;
    Serial.println("[BTN]SEL");
  }
  prevBtnSel = sel;

  // Button BPMNAV — cycle sensor yang dipilih untuk BPM
  bool bpmNav = digitalRead(BTN_BPMNAV);
  if (prevBtnBpmNav == HIGH && bpmNav == LOW && now - lastBpmNavTime > DEBOUNCE_MS) {
    lastBpmNavTime = now;
    bpmSel = (bpmSel + 1) % NUM_SENSORS;
    // Hantar BPM tersimpan sensor baru serta-merta — BUKAN posisi potensio
    Serial.printf("[BPMCTRL]%d|%d\n", bpmSel, sensorBpmArr[bpmSel]);
  }
  prevBtnBpmNav = bpmNav;

  // Button PITCHNAV — cycle sensor yang dipilih untuk Pitch
  bool pitchNav = digitalRead(BTN_PITCHNAV);
  if (prevBtnPitchNav == HIGH && pitchNav == LOW && now - lastPitchNavTime > DEBOUNCE_MS) {
    lastPitchNavTime = now;
    pitchSel = (pitchSel + 1) % NUM_SENSORS;
    // Hantar Pitch tersimpan sensor baru serta-merta — BUKAN posisi potensio
    Serial.printf("[PITCHCTRL]%d|%d\n", pitchSel, sensorPitchArr[pitchSel]);
  }
  prevBtnPitchNav = pitchNav;
}

// ── Serial command handler ─────────────────────────────────────
void handleCommand() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();

  if (cmd == "r") {
    calibrateBaseline();
  } else if (cmd == "s") {
    for (int s = 0; s < NUM_SENSORS; s++) {
      Serial.printf("[STATUS S%d] base=%d thr=%d|%d|%d|%d\n", s+1,
        baseline[s], thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3]);
    }
    Serial.printf("[DEBUG] NAV=%d SEL=%d\n",
      digitalRead(BTN_NAV), digitalRead(BTN_SEL));
  } else if (cmd == "b") {
    // Test: simulasi tekan button BPMNAV
    bpmSel = (bpmSel + 1) % NUM_SENSORS;
    Serial.printf("[BPMCTRL]%d|%d\n", bpmSel, sensorBpmArr[bpmSel]);
  } else if (cmd.startsWith("p")) {
    // Test: simulasi putar potensio — p<bpm>, contoh: p150
    int val = cmd.substring(1).toInt();
    if (val >= 40 && val <= 200) {
      sensorBpmArr[bpmSel] = val;
      potBpmPrev = val;
      Serial.printf("[BPMCTRL]%d|%d\n", bpmSel, val);
    }
  } else if (cmd.startsWith("T") && cmd.indexOf('=') > 0) {
    // Format: T<sensor><level>=<val>
    // Sensor 1–9: T11=100 (S1,L1), T81=500 (S8,L1)
    // Sensor 10+: tidak disokong — 8 sensor sahaja
    int s   = cmd.charAt(1) - '1';
    int lv  = cmd.charAt(2) - '1';
    int val = cmd.substring(cmd.indexOf('=') + 1).toInt();
    if (s >= 0 && s < NUM_SENSORS && lv >= 0 && lv < 4 && val > 0) {
      thresh[s][lv] = val;
      Serial.printf("[THRESH%d] %d|%d|%d|%d\n", s+1,
        thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3]);
    }
  }
}

// ── Loop ───────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // 1. Poll button dulu (sebelum I2C)
  pollButtons();

  // 2. Baca sensor tiap 2ms — EMA filter + adaptive baseline
  // EMA alpha=0.10: spike < 10ms ditolak (~90% attenuasi pada 1 sample)
  // Adaptive baseline: hanya update bila sensor dalam zon rehat (abs(dev) < thresh[0])
  //   → baseline perlahan ikut drift suhu/supply tanpa terjejas oleh magnet
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    lastSampleTime = now;
    for (int s = 0; s < NUM_SENSORS; s++) {
      float raw = (float)readSensor(s);
      emaAdc[s] = EMA_ALPHA_ARR[s] * raw + (1.0f - EMA_ALPHA_ARR[s]) * emaAdc[s];
      float dev = emaAdc[s] - fBaseline[s];
      // Adaptive baseline — hanya bila sensor idle (ledState == 0)
      // Tujuan: baseline mewakili keadaan tanpa magnet
      // Bila magnet diletakkan (ledState > 0) → baseline dibekukan
      // Bila magnet diangkat → baseline perlahan kembali ke nilai rehat
      if (ledState[s] == 0 && fabsf(dev) < (float)thresh[s][1]) {
        fBaseline[s] += BASE_ADAPT * dev;
        baseline[s]   = (int16_t)fBaseline[s];
      }
    }
  }

  // 3. Hantar data ke serial tiap 20ms (50Hz)
  if (now - lastSerialTime >= SERIAL_INTERVAL_MS) {
    lastSerialTime = now;

    int16_t curDev[NUM_SENSORS];
    int led[NUM_SENSORS];
    for (int s = 0; s < NUM_SENSORS; s++) {
      curDev[s] = (int16_t)(emaAdc[s] - fBaseline[s]);
      int raw = computeLed(s, curDev[s]);

      if (raw > 0) {
        // Devasi hadir — ON selepas HIT_CONFIRM frame (20ms)
        if (hitConfirm[s] < HIT_CONFIRM) hitConfirm[s]++;
        idleConfirm[s] = 0;
        if (hitConfirm[s] >= HIT_CONFIRM) ledState[s] = raw;
      } else {
        // Devasi hilang — OFF selepas IDLE_CONFIRM frame (80ms)
        // Hold lebih lama supaya signal tidak putus ditengah hit
        if (idleConfirm[s] < IDLE_CONFIRM) idleConfirm[s]++;
        hitConfirm[s] = 0;
        if (idleConfirm[s] >= IDLE_CONFIRM) ledState[s] = 0;
      }

      led[s] = ledState[s];
    }

    // Stuck detection dibuang — sensor harus ON selama magnet ada,
    // tidak ada batas waktu maksimum aktif.

    Serial.printf("HALL8|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d\n",
      (int16_t)emaAdc[0], curDev[0], led[0],
      (int16_t)emaAdc[1], curDev[1], led[1],
      (int16_t)emaAdc[2], curDev[2], led[2],
      (int16_t)emaAdc[3], curDev[3], led[3],
      (int16_t)emaAdc[4], curDev[4], led[4],
      (int16_t)emaAdc[5], curDev[5], led[5],
      (int16_t)emaAdc[6], curDev[6], led[6],
      (int16_t)emaAdc[7], curDev[7], led[7]);

    // Auto re-calibrate — guna EMA semasa terus, tiada blocking delay
    // EMA sudah difilter berterusan, nilainya tepat masa sensor idle
    if (baselineDone && now - lastBaselineTime > BASELINE_INTERVAL_MS) {
      lastBaselineTime = now;
      for (int s = 0; s < NUM_SENSORS; s++) {
        if (led[s] > 0) continue;  // sensor aktif — skip
        int16_t newBase = (int16_t)emaAdc[s];
        if (abs(newBase - baseline[s]) < 500) {
          baseline[s]  = newBase;
          fBaseline[s] = (float)newBase;
          // EMA tidak direset — biar terus berjalan tanpa gangguan
          Serial.printf("[AUTO S%d] baseline=%d\n", s+1, baseline[s]);
        }
      }
    }
  }

  // 4. Cek pergerakan potensio BPM setiap 100ms
  //    Hanya update BPM bila pot BERGERAK ≥ 2 BPM dari bacaan sebelum
  //    Sensor lain TIDAK terjejas — setiap sensor simpan BPM sendiri
  if (now - lastBpmSendTime >= BPM_SEND_INTERVAL_MS) {
    lastBpmSendTime = now;
    int potBpm = readBpm();
    if (abs(potBpm - potBpmPrev) >= 2) {
      potBpmPrev = potBpm;
      sensorBpmArr[bpmSel] = potBpm;  // update hanya sensor yang dipilih
      Serial.printf("[BPMCTRL]%d|%d\n", bpmSel, potBpm);
    }
  }

  // 4b. Cek pergerakan potensio Pitch setiap 100ms
  //     Hanya update Pitch bila pot BERGERAK dari bacaan sebelum
  if (now - lastPitchSendTime >= PITCH_SEND_INTERVAL_MS) {
    lastPitchSendTime = now;
    int potPitch = readPitch();
    if (potPitch != potPitchPrev) {
      potPitchPrev = potPitch;
      sensorPitchArr[pitchSel] = potPitch;  // update hanya sensor yang dipilih
      Serial.printf("[PITCHCTRL]%d|%d\n", pitchSel, potPitch);
    }
  }

  // 5. Cek command dari Serial
  handleCommand();
}
