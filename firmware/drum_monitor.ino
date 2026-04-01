/**
 * drum_monitor.ino — ESP32 Drum Monitor
 * Sensor: 4x Hall Effect via ADS1015 (A0–A3)
 * Encoder: HW-040 Rotary Encoder (CLK=34, DT=35, SW=32)
 * Button SAVE:   GPIO 25
 * Button DELETE: GPIO 26
 *
 * Serial Output @ 115200:
 *   HALL4|adc1|dev1|led1|adc2|dev2|led2|adc3|dev3|led3|adc4|dev4|led4
 *   [ENC]+1   — encoder putar kanan
 *   [ENC]-1   — encoder putar kiri
 *   [ENC]BTN  — encoder SW ditekan
 *   [BTN]SAVE — button SAVE ditekan
 *   [BTN]DEL  — button DELETE ditekan
 *   [THRESH#] d1|d2|d3|d4  — threshold sensor #
 *   [AUTO S#] baseline      — baseline auto-calibrated
 */

#include <Wire.h>
#include <Adafruit_ADS1X15.h>

// ── ADS1015 ────────────────────────────────────────────────────
Adafruit_ADS1015 ads;

// ── Pin HW-040 Rotary Encoder ──────────────────────────────────
#define ENC_CLK 34
#define ENC_DT  35
#define ENC_SW  27

// ── Pin Push Button ────────────────────────────────────────────
#define BTN_SAVE 25
#define BTN_DEL  26

// ── Sensor config ──────────────────────────────────────────────
#define NUM_SENSORS 4
#define SAMPLES_BASELINE 50
#define BASELINE_INTERVAL_MS 5000

// Threshold level (delta dari baseline untuk LED 1–4)
int thresh[NUM_SENSORS][4] = {
  {82, 329, 720, 1049},
  {82, 329, 720, 1049},
  {82, 329, 720, 1049},
  {82, 329, 720, 1049}
};

int16_t baseline[NUM_SENSORS]   = {0, 0, 0, 0};
int16_t lastAdc[NUM_SENSORS]    = {0, 0, 0, 0};
int     led[NUM_SENSORS]        = {0, 0, 0, 0};
bool    baselineDone            = false;
unsigned long lastBaselineTime  = 0;

// ── Encoder state (volatile — diakses dari ISR) ────────────────
volatile int  encPos     = 0;
volatile bool encBtnFlag = false;
int           lastEncPos = 0;
unsigned long lastEncBtnTime = 0;
#define ENC_DEBOUNCE_MS 200

// ── Button state ───────────────────────────────────────────────
unsigned long lastSaveTime = 0;
unsigned long lastDelTime  = 0;
#define BTN_DEBOUNCE_MS 50

// ── Encoder ISR ────────────────────────────────────────────────
void IRAM_ATTR onEncoderCLK() {
  int clk = digitalRead(ENC_CLK);
  int dt  = digitalRead(ENC_DT);
  if (clk == LOW) {
    if (dt == HIGH) encPos++;
    else            encPos--;
  }
}

void IRAM_ATTR onEncoderSW() {
  encBtnFlag = true;
}

// ── Setup ──────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  // ADS1015
  Wire.begin();
  if (!ads.begin()) {
    Serial.println("[ERR] ADS1015 tidak ditemui!");
    while (1) delay(100);
  }
  ads.setGain(GAIN_ONE);     // ±4.096V, resolusi 2mV/bit
  ads.setDataRate(RATE_ADS1015_3300SPS);

  // Encoder pins
  pinMode(ENC_CLK, INPUT_PULLUP);
  pinMode(ENC_DT,  INPUT_PULLUP);
  pinMode(ENC_SW,  INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(ENC_CLK), onEncoderCLK, FALLING);
  attachInterrupt(digitalPinToInterrupt(ENC_SW),  onEncoderSW,  FALLING);

  // Push button pins (active LOW, internal pull-up)
  pinMode(BTN_SAVE, INPUT_PULLUP);
  pinMode(BTN_DEL,  INPUT_PULLUP);

  // Calibrate baseline
  calibrateBaseline();

  // Print threshold info
  for (int s = 0; s < NUM_SENSORS; s++) {
    Serial.printf("[THRESH%d] %d|%d|%d|%d\n", s + 1,
      thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3]);
  }

  Serial.println("[READY]");
}

// ── Baseline Calibration ───────────────────────────────────────
void calibrateBaseline() {
  int32_t sum[NUM_SENSORS] = {0, 0, 0, 0};
  for (int n = 0; n < SAMPLES_BASELINE; n++) {
    for (int s = 0; s < NUM_SENSORS; s++) {
      sum[s] += ads.readADC_SingleEnded(s);
    }
    delay(5);
  }
  for (int s = 0; s < NUM_SENSORS; s++) {
    baseline[s] = (int16_t)(sum[s] / SAMPLES_BASELINE);
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

// ── Serial command handler (untuk threshold update dsb.) ───────
void handleCommand() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();

  // Format: T<sensor><level>=<value>  cth: T12=150  (sensor 1, level 2 = 150)
  if (cmd.startsWith("T") && cmd.length() >= 5 && cmd.indexOf('=') > 0) {
    int s  = cmd.charAt(1) - '1';
    int lv = cmd.charAt(2) - '1';
    int val = cmd.substring(cmd.indexOf('=') + 1).toInt();
    if (s >= 0 && s < NUM_SENSORS && lv >= 0 && lv < 4 && val > 0) {
      thresh[s][lv] = val;
      Serial.printf("[THRESH%d] %d|%d|%d|%d\n", s + 1,
        thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3]);
    }
  }
  // 'r' = reset baseline
  else if (cmd == "r") {
    calibrateBaseline();
  }
  // 's' = status
  else if (cmd == "s") {
    for (int s = 0; s < NUM_SENSORS; s++) {
      Serial.printf("[STATUS S%d] base=%d thr=%d|%d|%d|%d\n", s + 1,
        baseline[s], thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3]);
    }
  }
}

// ── Loop ───────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // ── 1. Baca sensor ──────────────────────────────────────────
  int16_t adc[NUM_SENSORS], dev[NUM_SENSORS];
  for (int s = 0; s < NUM_SENSORS; s++) {
    adc[s] = ads.readADC_SingleEnded(s);
    dev[s] = adc[s] - baseline[s];
    led[s] = computeLed(s, dev[s]);
  }

  // ── 2. Kirim data sensor ────────────────────────────────────
  Serial.printf("HALL4|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d\n",
    adc[0], dev[0], led[0],
    adc[1], dev[1], led[1],
    adc[2], dev[2], led[2],
    adc[3], dev[3], led[3]);

  // ── 3. Cek rotary encoder ───────────────────────────────────
  int curPos = encPos;  // baca atomic (int read di ESP32 atomic)
  if (curPos != lastEncPos) {
    int delta = curPos - lastEncPos;
    lastEncPos = curPos;
    if (delta > 0) Serial.println("[ENC]+1");
    else           Serial.println("[ENC]-1");
  }

  // Encoder SW button
  if (encBtnFlag) {
    encBtnFlag = false;
    if (now - lastEncBtnTime > ENC_DEBOUNCE_MS) {
      lastEncBtnTime = now;
      Serial.println("[ENC]BTN");
    }
  }

  // ── 4. Cek push button SAVE ─────────────────────────────────
  if (digitalRead(BTN_SAVE) == LOW) {
    if (now - lastSaveTime > BTN_DEBOUNCE_MS) {
      lastSaveTime = now;
      Serial.println("[BTN]SAVE");
      // Tunggu button dilepas
      while (digitalRead(BTN_SAVE) == LOW) delay(1);
    }
  }

  // ── 5. Cek push button DELETE ───────────────────────────────
  if (digitalRead(BTN_DEL) == LOW) {
    if (now - lastDelTime > BTN_DEBOUNCE_MS) {
      lastDelTime = now;
      Serial.println("[BTN]DEL");
      // Tunggu button dilepas
      while (digitalRead(BTN_DEL) == LOW) delay(1);
    }
  }

  // ── 6. Auto re-calibrate baseline (setiap 5 menit, saat idle) ──
  if (baselineDone && (now - lastBaselineTime > BASELINE_INTERVAL_MS)) {
    bool allIdle = true;
    for (int s = 0; s < NUM_SENSORS; s++) {
      if (led[s] > 0) { allIdle = false; break; }
    }
    if (allIdle) {
      for (int s = 0; s < NUM_SENSORS; s++) {
        int16_t newBase = ads.readADC_SingleEnded(s);
        // Smooth update: 90% lama + 10% baru
        baseline[s] = (int16_t)(baseline[s] * 0.9f + newBase * 0.1f);
        Serial.printf("[AUTO S%d] baseline=%d\n", s + 1, baseline[s]);
      }
      lastBaselineTime = now;
    }
  }

  // ── 7. Cek serial command masuk ────────────────────────────
  handleCommand();

  delay(3);  // ~333Hz sampling rate
}
