/**
 * drum_monitor.ino — ESP32 Drum Monitor
 * Sensor: 4x Hall Effect via ADS1015 (A0–A3)
 * Button NAV:    GPIO 26  ← navigasi ke sample berikutnya
 * Button SELECT: GPIO 25  ← confirm/simpan sample
 *
 * CATATAN PIN:
 *   GPIO 25/26 = mendukung INPUT_PULLUP (active LOW)
 *
 * Serial Output @ 115200:
 *   HALL4|adc1|dev1|led1|adc2|dev2|led2|adc3|dev3|led3|adc4|dev4|led4
 *   [BTN]NAV  — button NAV ditekan (GPIO 26) → next sample
 *   [BTN]SEL  — button SELECT ditekan (GPIO 25) → confirm/simpan sample
 */

#include <Wire.h>
#include <Adafruit_ADS1X15.h>

// ── ADS1015 ────────────────────────────────────────────────────
Adafruit_ADS1015 ads;

// ── Pin Push Button (active LOW) ───────────────────────────────
#define BTN_SEL 25   // SELECT — confirm/simpan sample
#define BTN_NAV 26   // NAV    — navigasi ke sample berikutnya

// ── Sensor config ──────────────────────────────────────────────
#define NUM_SENSORS 4
#define SAMPLES_BASELINE 50

int thresh[NUM_SENSORS][4] = {
  {82, 329, 720, 1049},
  {82, 329, 720, 1049},
  {82, 329, 720, 1049},
  {82, 329, 720, 1049}
};

int16_t baseline[NUM_SENSORS] = {0};
int     led[NUM_SENSORS]      = {0};
bool    baselineDone          = false;
unsigned long lastBaselineTime = 0;
#define BASELINE_INTERVAL_MS 300000UL  // 5 menit

// ── Debounce non-blocking ──────────────────────────────────────
unsigned long lastSelTime = 0;
unsigned long lastNavTime = 0;
bool prevBtnSel = HIGH;
bool prevBtnNav = HIGH;
#define DEBOUNCE_MS 80

// ── Setup ──────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(BTN_SEL, INPUT_PULLUP);
  pinMode(BTN_NAV, INPUT_PULLUP);

  // ADS1015
  Wire.begin();
  if (!ads.begin()) {
    Serial.println("[ERR] ADS1015 tidak ditemui! Periksa koneksi I2C.");
    while (1) delay(500);
  }
  ads.setGain(GAIN_ONE);
  ads.setDataRate(RATE_ADS1015_3300SPS);

  calibrateBaseline();

  for (int s = 0; s < NUM_SENSORS; s++) {
    Serial.printf("[THRESH%d] %d|%d|%d|%d\n", s + 1,
      thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3]);
  }

  Serial.printf("[DEBUG] SEL=%d NAV=%d\n",
    digitalRead(BTN_SEL), digitalRead(BTN_NAV));

  Serial.println("[READY]");
}

// ── Baseline Calibration ───────────────────────────────────────
void calibrateBaseline() {
  long sum[NUM_SENSORS] = {0};
  for (int n = 0; n < SAMPLES_BASELINE; n++) {
    for (int s = 0; s < NUM_SENSORS; s++) sum[s] += ads.readADC_SingleEnded(s);
    delay(5);
  }
  for (int s = 0; s < NUM_SENSORS; s++) {
    baseline[s] = sum[s] / SAMPLES_BASELINE;
    Serial.printf("[INIT S%d] baseline=%d\n", s + 1, baseline[s]);
  }
  baselineDone = true;
  lastBaselineTime = millis();
}

// ── Compute LED level ──────────────────────────────────────────
int computeLed(int sIdx, int16_t dev) {
  for (int lv = 3; lv >= 0; lv--) {
    if (abs(dev) >= thresh[sIdx][lv]) return lv + 1;
  }
  return 0;
}

// ── Cek button tanpa blocking ──────────────────────────────────
void checkButtons() {
  unsigned long now = millis();

  bool selNow = digitalRead(BTN_SEL);
  if (prevBtnSel == HIGH && selNow == LOW && now - lastSelTime > DEBOUNCE_MS) {
    lastSelTime = now;
    Serial.println("[BTN]SEL");
  }
  prevBtnSel = selNow;

  bool navNow = digitalRead(BTN_NAV);
  if (prevBtnNav == HIGH && navNow == LOW && now - lastNavTime > DEBOUNCE_MS) {
    lastNavTime = now;
    Serial.println("[BTN]NAV");
  }
  prevBtnNav = navNow;
}

// ── Serial command handler ─────────────────────────────────────
void handleCommand() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  if (cmd == "r") { calibrateBaseline(); }
  else if (cmd == "s") {
    for (int s = 0; s < NUM_SENSORS; s++) {
      Serial.printf("[STATUS S%d] base=%d thr=%d|%d|%d|%d\n", s+1,
        baseline[s], thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3]);
    }
    Serial.printf("[DEBUG] SEL=%d NAV=%d\n",
      digitalRead(BTN_SEL), digitalRead(BTN_NAV));
  }
  else if (cmd.startsWith("T") && cmd.length() >= 5 && cmd.indexOf('=') > 0) {
    int s  = cmd.charAt(1) - '1';
    int lv = cmd.charAt(2) - '1';
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

  // 1. Button — cek setiap loop (non-blocking)
  checkButtons();

  // 2. Baca sensor
  int16_t adc[NUM_SENSORS], dev[NUM_SENSORS];
  for (int s = 0; s < NUM_SENSORS; s++) {
    adc[s] = ads.readADC_SingleEnded(s);
    dev[s] = adc[s] - baseline[s];
    led[s] = computeLed(s, dev[s]);
  }

  // 3. Kirim data sensor
  Serial.printf("HALL4|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d\n",
    adc[0], dev[0], led[0],
    adc[1], dev[1], led[1],
    adc[2], dev[2], led[2],
    adc[3], dev[3], led[3]);

  // 4. Auto re-calibrate baseline (saat semua sensor idle)
  if (baselineDone && now - lastBaselineTime > BASELINE_INTERVAL_MS) {
    bool allIdle = true;
    for (int s = 0; s < NUM_SENSORS; s++) if (led[s] > 0) { allIdle = false; break; }
    if (allIdle) {
      for (int s = 0; s < NUM_SENSORS; s++) {
        int16_t nb = ads.readADC_SingleEnded(s);
        baseline[s] = (int16_t)(baseline[s] * 0.9f + nb * 0.1f);
        Serial.printf("[AUTO S%d] baseline=%d\n", s+1, baseline[s]);
      }
      lastBaselineTime = now;
    }
  }

  // 5. Cek serial command masuk
  handleCommand();

  delay(3);
}
