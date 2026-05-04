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
#define SAMPLES_BASELINE     200        // lebih banyak sample = baseline lebih tepat
#define DEBOUNCE_MS          80

// Output ke serial tiap 20ms (50Hz), baca sensor tiap 2ms (500Hz)
#define SERIAL_INTERVAL_MS   20
#define SAMPLE_INTERVAL_MS   2

// Threshold dikira dari noise floor:
//   ADS1015 (1mV/count):   S1-S4 noise max=65 → L1=80
//   ADS1115 (0.0625mV/count): S5-S8 noise max=87 → L1=384
// DUAL_ADS1115: semua 8 sensor guna skala ADS1115
#ifdef DUAL_ADS1115
int thresh[NUM_SENSORS][4] = {
  {384, 960, 1920, 3200},  // S1
  {384, 960, 1920, 3200},  // S2
  {384, 960, 1920, 3200},  // S3
  {384, 960, 1920, 3200},  // S4
  {384, 960, 1920, 3200},  // S5
  {384, 960, 1920, 3200},  // S6
  {384, 960, 1920, 3200},  // S7
  {384, 960, 1920, 3200},  // S8
};
#else
int thresh[NUM_SENSORS][4] = {
  {80,  130, 180, 200},    // S1
  {80,  130, 180, 200},    // S2
  {80,  130, 180, 200},    // S3
  {80,  130, 180, 200},    // S4
  {384, 960, 1920, 3200},  // S5
  {384, 960, 1920, 3200},  // S6
  {384, 960, 1920, 3200},  // S7
  {384, 960, 1920, 3200},  // S8
};
#endif

// Arah deviasi yang sah bagi setiap sensor apabila magnet mendekat:
//  +1 = dev mesti POSITIF (magnet menaikkan bacaan ADC)
//  -1 = dev mesti NEGATIF (magnet menurunkan bacaan ADC)
// Disahkan dari dua sesi log (20260504 + 20260505)
int hitDir[NUM_SENSORS] = { -1, +1, -1, +1, +1, -1, -1, -1 };

int16_t baseline[NUM_SENSORS] = {0};

// ── Peak detection state ───────────────────────────────────────
int16_t peakAdc[NUM_SENSORS] = {0};
int16_t peakDev[NUM_SENSORS] = {0};

// ── Hysteresis counter (cegah cross-trigger antara sensor) ────
// LED hanya aktif bila devasi kekal > threshold 2 frame berturut-turut (40ms)
// LED hanya mati bila devasi < threshold 2 frame berturut-turut (40ms)
uint8_t hitConfirm[NUM_SENSORS] = {0};   // frame counter naik
uint8_t idleConfirm[NUM_SENSORS] = {0};  // frame counter turun
int     ledState[NUM_SENSORS]    = {0};  // LED state selepas hysteresis
#define CONFIRM_FRAMES 2

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
    Serial.printf("[THRESH%d] %d|%d|%d|%d | dir=%+d\n", s+1,
      thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3], hitDir[s]);
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

// ── Calibrate baseline (median filter) ────────────────────────
// Median lebih tahan outlier berbanding average
void calibrateBaseline() {
  Serial.println("[CAL] Mengambil baseline...");
  int16_t buf[SAMPLES_BASELINE];
  for (int s = 0; s < NUM_SENSORS; s++) {
    for (int n = 0; n < SAMPLES_BASELINE; n++) {
      buf[n] = readSensor(s);
      delay(2);
    }
    sortArr(buf, SAMPLES_BASELINE);
    baseline[s] = buf[SAMPLES_BASELINE / 2];   // median
    peakAdc[s]  = baseline[s];
    peakDev[s]  = 0;
    Serial.printf("[INIT S%d] baseline=%d\n", s+1, baseline[s]);
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
        // Devasi hadir — kira frame naik
        if (hitConfirm[s] < CONFIRM_FRAMES) hitConfirm[s]++;
        idleConfirm[s] = 0;
        if (hitConfirm[s] >= CONFIRM_FRAMES) ledState[s] = raw;
      } else {
        // Devasi hilang — kira frame turun
        if (idleConfirm[s] < CONFIRM_FRAMES) idleConfirm[s]++;
        hitConfirm[s] = 0;
        if (idleConfirm[s] >= CONFIRM_FRAMES) ledState[s] = 0;
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
