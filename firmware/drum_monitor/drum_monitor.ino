/**
 * drum_monitor.ino — ESP32 Drum Monitor
 * Sensor : 8x Hall Effect
 *
 * Konfigurasi A (default): ADS1015 @ 0x48 + ADS1115 @ 0x49
 * Konfigurasi B (DUAL_ADS1115): ADS1115 @ 0x48 + ADS1115 @ 0x49
 *
 * Pilih konfigurasi di platformio.ini:
 *   env:esp32dev         → Konfigurasi A
 *   env:esp32dev_dual1115 → Konfigurasi B (build_flags = -DDUAL_ADS1115)
 */

#include <Wire.h>
#include <Adafruit_ADS1X15.h>

// ── ADS chips ──────────────────────────────────────────────────
#ifdef DUAL_ADS1115
Adafruit_ADS1115 ads1;   // 0x48 — S1–S4 (ADS1115, 16-bit)
#else
Adafruit_ADS1015 ads1;   // 0x48 — S1–S4 (ADS1015, 12-bit)
#endif
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
#define BTN_PITCHNAV 32   // Button pilih sensor Pitch

// ── Pin Potensio ───────────────────────────────────────────────
#define POT_BPM    34   // ADC1 CH6, input-only
#define POT_PITCH  35   // ADC1 CH7, input-only

// ── Sensor config ──────────────────────────────────────────────
#define NUM_SENSORS          8
#define SAMPLES_BASELINE     500        // 500 × 2ms = 1s per sensor (lebih stabil)
#define CAL_DELAY_MS         3000       // tunggu 3s sebelum kalibrasi (bagi drum settle)
#define DEBOUNCE_MS          80

// Output ke serial tiap 20ms (50Hz), baca sensor tiap 2ms (500Hz)
#define SERIAL_INTERVAL_MS   20
#define SAMPLE_INTERVAL_MS   2

// Adaptive baseline: perlahan betulkan drift suhu/elektrik semasa sensor idle
// alpha = 5/1000 = 0.005 → lebih lambat, kurang hanyut dari gangguan seketika
// +DEN/2 rounding: elak dead zone
#define ADAPT_NUM  5
#define ADAPT_DEN  1000

// Tiada auto-recal — sensor kekal ON selagi magnet ada, OFF bila magnet jauh
// Jika baseline hanyut, hantar command 'r' untuk kalibrasi semula manual

// Threshold dikira dari noise floor + margin:
//   ADS1015 (1mV/count):   S1-S4 noise max=±4 cnt → L1=80 (20× margin, 80mV min)
//   ADS1115 (0.0625mV/count): S5-S8 noise max=±15 cnt → L1=200 (13× margin, 12.5mV min)
// DUAL_ADS1115: semua 8 sensor guna skala ADS1115
#ifdef DUAL_ADS1115
int thresh[NUM_SENSORS][4] = {
  {200,  600, 1500, 3000},  // S1
  {200,  600, 1500, 3000},  // S2
  {200,  600, 1500, 3000},  // S3
  {200,  600, 1500, 3000},  // S4
  {200,  600, 1500, 3000},  // S5
  {200,  600, 1500, 3000},  // S6
  {200,  600, 1500, 3000},  // S7
  {200,  600, 1500, 3000},  // S8
};
#else
int thresh[NUM_SENSORS][4] = {
  {80,  200,  400,  700},  // S1  (ADS1015 1mV/count, noise floor ±4)
  {80,  200,  400,  700},  // S2
  {80,  200,  400,  700},  // S3
  {80,  200,  400,  700},  // S4
  {200, 600, 1500, 3000},  // S5  (ADS1115 0.0625mV/count, noise floor ±15)
  {200, 600, 1500, 3000},  // S6
  {200, 600, 1500, 3000},  // S7
  {200, 600, 1500, 3000},  // S8
};
#endif

// Arah deviasi yang sah bagi setiap sensor apabila magnet mendekat:
//  +1 = dev mesti POSITIF (magnet menaikkan bacaan ADC)
//  -1 = dev mesti NEGATIF (magnet menurunkan bacaan ADC)
// Disahkan dari dua sesi log (20260504 + 20260505)
int hitDir[NUM_SENSORS] = { -1, +1, -1, +1, +1, +1, +1, +1 };

int16_t baseline[NUM_SENSORS]   = {0};
int16_t noiseFloor[NUM_SENSORS] = {0};  // diukur semasa kalibrasi, dipakai set threshold

// ── Peak detection state ───────────────────────────────────────
int16_t peakAdc[NUM_SENSORS] = {0};
int16_t peakDev[NUM_SENSORS] = {0};

// ── Hysteresis counter ────────────────────────────────────────
// ON  cepat : 1 frame (20ms)  — respons segera bila magnet dekat
// OFF lambat: 5 frame (100ms) — cegah flicker bila signal magnet sedikit naik turun
#define CONFIRM_ON  2
#define CONFIRM_OFF 5
uint8_t hitConfirm[NUM_SENSORS]  = {0};
uint8_t idleConfirm[NUM_SENSORS] = {0};
int     ledState[NUM_SENSORS]    = {0};

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

  // ads1 @ 0x48
  if (!ads1.begin(0x48)) {
#ifdef DUAL_ADS1115
    Serial.println("[ERR] ADS1115 (0x48) tidak ditemui! Pastikan ADDR pin = GND");
#else
    Serial.println("[ERR] ADS1015 (0x48) tidak ditemui!");
#endif
    while (1) delay(500);
  }
#ifdef DUAL_ADS1115
  ads1.setGain(GAIN_TWO);
  ads1.setDataRate(RATE_ADS1115_860SPS);
#else
  ads1.setGain(GAIN_TWO);   // ±2.048V — 1mV/count, 2× lebih sensitif
  ads1.setDataRate(RATE_ADS1015_1600SPS);  // 3300→1600 kurangkan noise antara channel
#endif

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
    Serial.printf("[THRESH%d] %d|%d|%d|%d | dir=%+d | noise=±%d\n", s+1,
      thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3], hitDir[s], noiseFloor[s]);
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

// ── Calibrate baseline (serentak semua sensor, median filter) ─
// Semua 8 sensor dikalibrasi dalam window masa yang sama
// supaya drift posisi magnet tidak mempengaruhi kalibrasi berbeza sensor
void calibrateBaseline() {
  // Tunggu drum/magnet settle sebelum ambil sample
  Serial.println("[CAL] Letakkan drum dalam posisi rehat...");
  for (int i = CAL_DELAY_MS / 1000; i > 0; i--) {
    Serial.printf("[CAL] %ds...\n", i);
    delay(1000);
  }

  // Warmup ADC — bagi chip keluar dari power-down dan settle sebelum ambil baseline
  // Tanpa ini, bacaan awal ~100 count lebih rendah dari steady-state
  Serial.println("[CAL] Warming up ADC...");
  for (int n = 0; n < 150; n++) {
    for (int s = 0; s < NUM_SENSORS; s++) readSensor(s);
    delay(2);
  }

  Serial.println("[CAL] Mengambil baseline (semua sensor serentak)...");
  // Buffer statik (500×8×2 = 8KB) — elak stack overflow
  static int16_t buf[NUM_SENSORS][SAMPLES_BASELINE];

  for (int n = 0; n < SAMPLES_BASELINE; n++) {
    for (int s = 0; s < NUM_SENSORS; s++) buf[s][n] = readSensor(s);
    delay(2);
  }

  // Sort setiap sensor, ambil median + ukur noise floor
  int16_t tmp[SAMPLES_BASELINE];
  for (int s = 0; s < NUM_SENSORS; s++) {
    memcpy(tmp, buf[s], sizeof(tmp));
    sortArr(tmp, SAMPLES_BASELINE);
    baseline[s] = tmp[SAMPLES_BASELINE / 2];
    peakAdc[s]  = baseline[s];
    peakDev[s]  = 0;

    // Noise floor = sisihan max dalam 5th–95th percentile (elak outlier)
    // Ini anggaran ~1.65σ → L1 = 8× = ~13σ margin dari noise
    int dn = abs((int)baseline[s] - (int)tmp[SAMPLES_BASELINE * 5 / 100]);
    int dp = abs((int)tmp[SAMPLES_BASELINE * 95 / 100] - (int)baseline[s]);
    int noise = max(dn, dp);
    if (noise < 1) noise = 1;
    noiseFloor[s] = (int16_t)noise;

    // Auto-set threshold berdasarkan noise floor setiap sensor
    // Minimum floor diskala mengikut resolusi ADC:
    //   ADS1015 (12-bit, 1mV/count)   → floor standard
    //   ADS1115 (16-bit, 0.0625mV/count) → floor ×16 untuk sensitiviti setara
    // Tanpa scaling ini, ADS1115 (S5-S8) akan trigger terlalu mudah
    // kerana noise floor dalam raw count sangat kecil → max() ambil floor yang rendah
    #ifdef DUAL_ADS1115
    const int fMul = 16;   // semua sensor ADS1115
    #else
    const int fMul = (s >= 4) ? 16 : 1;  // S1-S4=ADS1015, S5-S8=ADS1115
    #endif
    thresh[s][0] = max(noise * 12,   50  * fMul);
    thresh[s][1] = max(noise * 30,  150  * fMul);
    thresh[s][2] = max(noise * 75,  400  * fMul);
    thresh[s][3] = max(noise * 150, 800  * fMul);

    Serial.printf("[INIT S%d] base=%d noise=±%d thr=%d|%d|%d|%d\n", s+1,
      baseline[s], noise,
      thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3]);
  }
  Serial.println("[CAL] Selesai.");
}

// ── Compute LED level ──────────────────────────────────────────
// Hanya kira hit jika deviasi dalam arah yang betul (hitDir)
// Ini elak false trigger dari noise arah lawan
int computeLed(int sIdx, int16_t dev) {
  int signedDev = dev * hitDir[sIdx];   // positifkan jika arah betul
  if (signedDev <= 0) return 0;         // arah salah → bukan hit
  for (int lv = 3; lv >= 0; lv--)
    if (signedDev >= thresh[sIdx][lv]) return lv + 1;
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
      Serial.printf("[STATUS S%d] base=%d noise=±%d thr=%d|%d|%d|%d dir=%+d\n", s+1,
        baseline[s], noiseFloor[s],
        thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3], hitDir[s]);
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
  } else if (cmd.startsWith("D") && cmd.length() >= 3) {
    // Tukar arah hit sensor: D<1-8><+|->  contoh: D1-  D5+
    int s  = cmd.charAt(1) - '1';
    char d = cmd.charAt(2);
    if (s >= 0 && s < NUM_SENSORS && (d == '+' || d == '-')) {
      hitDir[s] = (d == '+') ? +1 : -1;
      Serial.printf("[DIR S%d] hitDir=%+d\n", s+1, hitDir[s]);
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
  } else if (cmd.startsWith("B") && cmd.indexOf('=') > 0) {
    // Manual baseline override: B<sensor>=<val>, contoh: B3=1024
    int s   = cmd.charAt(1) - '1';
    int val = cmd.substring(cmd.indexOf('=') + 1).toInt();
    if (s >= 0 && s < NUM_SENSORS && val != 0) {
      baseline[s] = (int16_t)val;
      Serial.printf("[BASE S%d] baseline=%d\n", s+1, baseline[s]);
    }
  }
}

// ── Loop ───────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // 1. Poll button dulu (sebelum I2C)
  pollButtons();

  // 2. Baca sensor tiap 2ms — peak detection sahaja
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    lastSampleTime = now;
    for (int s = 0; s < NUM_SENSORS; s++) {
      int16_t adc = readSensor(s);
      int16_t dev = adc - baseline[s];
      if (abs(dev) > abs(peakDev[s])) {
        peakAdc[s] = adc;
        peakDev[s] = dev;
      }
    }
  }

  // 3. Hantar data ke serial tiap 20ms (50Hz)
  if (now - lastSerialTime >= SERIAL_INTERVAL_MS) {
    lastSerialTime = now;

    int led[NUM_SENSORS];
    for (int s = 0; s < NUM_SENSORS; s++) {
      int raw = computeLed(s, peakDev[s]);

      if (raw > 0) {
        if (hitConfirm[s] < CONFIRM_ON) hitConfirm[s]++;
        idleConfirm[s] = 0;
        if (hitConfirm[s] >= CONFIRM_ON) ledState[s] = raw;
      } else {
        if (idleConfirm[s] < CONFIRM_OFF) idleConfirm[s]++;
        hitConfirm[s] = 0;
        if (idleConfirm[s] >= CONFIRM_OFF) ledState[s] = 0;
      }

      led[s] = ledState[s];
    }

    Serial.printf("HALL8|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d\n",
      peakAdc[0], peakDev[0], led[0],
      peakAdc[1], peakDev[1], led[1],
      peakAdc[2], peakDev[2], led[2],
      peakAdc[3], peakDev[3], led[3],
      peakAdc[4], peakDev[4], led[4],
      peakAdc[5], peakDev[5], led[5],
      peakAdc[6], peakDev[6], led[6],
      peakAdc[7], peakDev[7], led[7]);

    // Adaptive baseline — EMA hanya bila sensor betul-betul idle
    // Guard: berhenti EMA bila signal dah hampir threshold (abs dev < L1/2)
    // Ini cegah baseline hanyut semasa ada gangguan kecil tapi belum trigger
    for (int s = 0; s < NUM_SENSORS; s++) {
      if (ledState[s] == 0 && abs((int)peakDev[s]) < thresh[s][0] / 2) {
        baseline[s] = (int16_t)(
          ((long)baseline[s] * (ADAPT_DEN - ADAPT_NUM)
           + (long)peakAdc[s] * ADAPT_NUM
           + ADAPT_DEN / 2)
          / ADAPT_DEN
        );
      }
    }

    // Reset peak selepas dihantar
    for (int s = 0; s < NUM_SENSORS; s++) {
      peakAdc[s] = baseline[s];
      peakDev[s] = 0;
    }

  }

  // 4. Cek pergerakan potensio BPM setiap 100ms
  //    Hanya update BPM bila pot BERGERAK ≥ 3 BPM dari bacaan sebelum
  //    Sensor lain TIDAK terjejas — setiap sensor simpan BPM sendiri
  if (now - lastBpmSendTime >= BPM_SEND_INTERVAL_MS) {
    lastBpmSendTime = now;
    int potBpm = readBpm();
    if (abs(potBpm - potBpmPrev) >= 3) {
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
