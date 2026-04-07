/**
 * drum_monitor.ino — ESP32 Drum Monitor
 * Sensor : 8x Hall Effect
 *   ADS1015 @ 0x48 (ADDR=GND) — S1–S4 (A0–A3)
 *   ADS1115 @ 0x49 (ADDR=VDD) — S5–S8 (A0–A3)
 * Button NAV    : GPIO 26  — tekan untuk next sample
 * Button SEL    : GPIO 25  — tekan untuk simpan/confirm sample
 * Button BPMNAV : GPIO 27  — tekan untuk pilih sensor BPM (S1→S2→...→S8→S1)
 * Potensio BPM  : GPIO 34  — putar untuk ubah BPM sensor dipilih (40–200 BPM)
 *
 * CATATAN PIN:
 *   GPIO 25/26/27 = mendukung INPUT_PULLUP (active LOW)
 *   GPIO 34       = ADC1 CH6, input-only, untuk potensio
 *   I2C : SDA=21, SCL=22 (kongsi oleh kedua-dua ADS)
 *   ADS1015 ADDR pin → GND  (alamat 0x48) — GAIN_TWO, 1mV/count
 *   ADS1115 ADDR pin → VDD  (alamat 0x49) — GAIN_TWO, 0.0625mV/count
 *
 * Serial Output @ 115200:
 *   HALL8|adc1|dev1|led1|...|adc8|dev8|led8  (24 nilai)
 *   [BTN]NAV         — button NAV ditekan  (GPIO 26)
 *   [BTN]SEL         — button SEL ditekan  (GPIO 25)
 *   [BPMCTRL]sel|bpm — BPM semasa (setiap 100ms), sel=0–7
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
#define BTN_NAV    26
#define BTN_SEL    25
#define BTN_BPMNAV 27   // Button pilih sensor BPM

// ── Pin Potensio BPM ───────────────────────────────────────────
#define POT_BPM    34   // ADC1 CH6, input-only

// ── Sensor config ──────────────────────────────────────────────
#define NUM_SENSORS          8
#define SAMPLES_BASELINE     200        // lebih banyak sample = baseline lebih tepat
#define DEBOUNCE_MS          80
#define BASELINE_INTERVAL_MS 30000UL    // 30 saat — recal bila semua sensor idle

// Output ke serial tiap 20ms (50Hz), baca sensor tiap 2ms (500Hz)
#define SERIAL_INTERVAL_MS   20
#define SAMPLE_INTERVAL_MS   2

// S1–S4: ADS1015 (1mV/count @ GAIN_TWO) — minimum threshold
// S5–S8: ADS1115 (0.0625mV/count @ GAIN_TWO) — minimum threshold
int thresh[NUM_SENSORS][4] = {
  {10,  25,  60,  120},     // S1
  {10,  25,  60,  120},     // S2
  {10,  25,  60,  120},     // S3
  {10,  25,  60,  120},     // S4
  {80,  200, 600, 1200},    // S5
  {80,  200, 600, 1200},    // S6
  {80,  200, 600, 1200},    // S7
  {80,  200, 600, 1200},    // S8
};

int16_t baseline[NUM_SENSORS] = {0};
bool    baselineDone           = false;
unsigned long lastBaselineTime = 0;

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
bool          prevBtnNav    = HIGH;
bool          prevBtnSel    = HIGH;
bool          prevBtnBpmNav = HIGH;
unsigned long lastNavTime    = 0;
unsigned long lastSelTime    = 0;
unsigned long lastBpmNavTime = 0;

// ── BPM control state ──────────────────────────────────────────
int           bpmSel         = 0;     // Sensor yang dipilih untuk BPM (0–7)

// ── Timing ────────────────────────────────────────────────────
unsigned long lastSampleTime = 0;
unsigned long lastSerialTime = 0;
unsigned long lastBpmSendTime = 0;
#define BPM_SEND_INTERVAL_MS 100      // Hantar [BPMCTRL] setiap 100ms

// ── Setup ──────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(BTN_NAV,    INPUT_PULLUP);
  pinMode(BTN_SEL,    INPUT_PULLUP);
  pinMode(BTN_BPMNAV, INPUT_PULLUP);

  Wire.begin();

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

  for (int s = 0; s < NUM_SENSORS; s++) {
    Serial.printf("[THRESH%d] %d|%d|%d|%d\n", s+1,
      thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3]);
  }

  Serial.printf("[DEBUG] NAV=%d SEL=%d BPMNAV=%d POT=%d\n",
    digitalRead(BTN_NAV), digitalRead(BTN_SEL),
    digitalRead(BTN_BPMNAV), analogRead(POT_BPM));
  Serial.println("[READY]");
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

// ── Baca potensio → BPM (40–200) ──────────────────────────────
int readBpm() {
  int raw = analogRead(POT_BPM);   // 0–4095
  return map(raw, 0, 4095, 40, 200);
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
    Serial.printf("[BPMSEL]%d\n", bpmSel);  // maklum balik segera
  }
  prevBtnBpmNav = bpmNav;
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
  // Baseline TIDAK diupdate di sini — rolling baseline menyebabkan baseline
  // drift ke posisi magnet → bila magnet diangkat, abs(dev) besar → bunyi lengket
  // Baseline diurus oleh: calibrateBaseline() at boot + auto-recal 5 minit
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

    // Auto re-calibrate bila semua sensor idle (setiap 30 saat)
    // Ambil median 20 sample — lebih tepat dari single reading
    if (baselineDone && now - lastBaselineTime > BASELINE_INTERVAL_MS) {
      bool allIdle = true;
      for (int s = 0; s < NUM_SENSORS; s++)
        if (led[s] > 0) { allIdle = false; break; }
      if (allIdle) {
        int16_t buf[20];
        for (int s = 0; s < NUM_SENSORS; s++) {
          for (int n = 0; n < 20; n++) { buf[n] = readSensor(s); delay(2); }
          sortArr(buf, 20);
          int16_t med = buf[10];
          // Hanya update jika perbezaan kecil — elak lompatan besar
          if (abs(med - baseline[s]) < 200) {
            baseline[s] = med;
            Serial.printf("[AUTO S%d] baseline=%d\n", s+1, baseline[s]);
          }
        }
        lastBaselineTime = now;
      }
    }
  }

  // 4. Hantar [BPMCTRL] setiap 100ms
  if (now - lastBpmSendTime >= BPM_SEND_INTERVAL_MS) {
    lastBpmSendTime = now;
    Serial.printf("[BPMCTRL]%d|%d\n", bpmSel, readBpm());
  }

  // 5. Cek command dari Serial
  handleCommand();
}
