/**
 * drum_monitor.ino — ESP32 Drum Monitor
 * Sensor : 4x Hall Effect via ADS1015 (A0–A3)
 * Button NAV : GPIO 26  — tekan untuk next sample
 * Button SEL : GPIO 25  — tekan untuk simpan/confirm sample
 *
 * CATATAN PIN:
 *   GPIO 25/26 = mendukung INPUT_PULLUP (active LOW)
 *   I2C : SDA=21, SCL=22
 *
 * Serial Output @ 115200:
 *   HALL4|adc1|dev1|led1|adc2|dev2|led2|adc3|dev3|led3|adc4|dev4|led4
 *   [BTN]NAV  — button NAV ditekan  (GPIO 26)
 *   [BTN]SEL  — button SEL ditekan  (GPIO 25)
 */

#include <Wire.h>
#include <Adafruit_ADS1X15.h>

// ── ADS1015 ────────────────────────────────────────────────────
Adafruit_ADS1015 ads;

// ── Pin Button (active LOW, internal pull-up) ──────────────────
#define BTN_NAV 26   // Navigasi ke sample berikutnya
#define BTN_SEL 25   // Confirm/simpan sample

// ── Sensor config ──────────────────────────────────────────────
#define NUM_SENSORS      4
#define SAMPLES_BASELINE 50
#define DEBOUNCE_MS      80
#define BASELINE_INTERVAL_MS 300000UL   // 5 minit

int thresh[NUM_SENSORS][4] = {
  {82, 329, 720, 1049},
  {82, 329, 720, 1049},
  {82, 329, 720, 1049},
  {82, 329, 720, 1049}
};

int16_t baseline[NUM_SENSORS] = {0};
int     led[NUM_SENSORS]      = {0};
bool    baselineDone           = false;
unsigned long lastBaselineTime = 0;

// ── Debounce state ─────────────────────────────────────────────
bool          prevBtnNav  = HIGH;
bool          prevBtnSel  = HIGH;
unsigned long lastNavTime = 0;
unsigned long lastSelTime = 0;

// ── Setup ──────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(BTN_NAV, INPUT_PULLUP);
  pinMode(BTN_SEL, INPUT_PULLUP);

  Wire.begin();
  if (!ads.begin()) {
    Serial.println("[ERR] ADS1015 tidak ditemui!");
    while (1) delay(500);
  }
  ads.setGain(GAIN_ONE);
  ads.setDataRate(RATE_ADS1015_3300SPS);

  calibrateBaseline();

  for (int s = 0; s < NUM_SENSORS; s++) {
    Serial.printf("[THRESH%d] %d|%d|%d|%d\n", s+1,
      thresh[s][0], thresh[s][1], thresh[s][2], thresh[s][3]);
  }

  Serial.printf("[DEBUG] NAV=%d SEL=%d\n",
    digitalRead(BTN_NAV), digitalRead(BTN_SEL));
  Serial.println("[READY]");
}

// ── Calibrate baseline ─────────────────────────────────────────
void calibrateBaseline() {
  Serial.println("[CAL] Mengambil baseline...");
  long sum[NUM_SENSORS] = {0};
  for (int n = 0; n < SAMPLES_BASELINE; n++) {
    for (int s = 0; s < NUM_SENSORS; s++)
      sum[s] += ads.readADC_SingleEnded(s);
    delay(5);
  }
  for (int s = 0; s < NUM_SENSORS; s++) {
    baseline[s] = sum[s] / SAMPLES_BASELINE;
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
    // Format: T<sensor><level>=<val>  contoh: T11=100
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

  // 1. Poll button dulu (sebelum I2C yang lambat)
  pollButtons();

  // 2. Baca 4 sensor
  int16_t adc[NUM_SENSORS], dev[NUM_SENSORS];
  for (int s = 0; s < NUM_SENSORS; s++) {
    adc[s] = ads.readADC_SingleEnded(s);
    dev[s] = adc[s] - baseline[s];
    led[s] = computeLed(s, dev[s]);
  }

  // 3. Hantar data sensor ke serial
  Serial.printf("HALL4|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d|%d\n",
    adc[0], dev[0], led[0],
    adc[1], dev[1], led[1],
    adc[2], dev[2], led[2],
    adc[3], dev[3], led[3]);

  // 4. Auto re-calibrate baseline bila semua sensor idle (setiap 5 minit)
  if (baselineDone && now - lastBaselineTime > BASELINE_INTERVAL_MS) {
    bool allIdle = true;
    for (int s = 0; s < NUM_SENSORS; s++)
      if (led[s] > 0) { allIdle = false; break; }
    if (allIdle) {
      for (int s = 0; s < NUM_SENSORS; s++) {
        int16_t nb = ads.readADC_SingleEnded(s);
        baseline[s] = (int16_t)(baseline[s] * 0.9f + nb * 0.1f);
        Serial.printf("[AUTO S%d] baseline=%d\n", s+1, baseline[s]);
      }
      lastBaselineTime = now;
    }
  }

  // 5. Cek command dari Serial
  handleCommand();

  delay(3);
}
