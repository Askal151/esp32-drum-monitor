# ESP32 Drum Monitor — Hardware Schematic

## Ringkasan Sistem

```
┌─────────────────────────────────────────────────────────────┐
│                        ESP32 DevKit                          │
│                                                             │
│  USB ─── CP210x UART ─── Serial (115200 baud)               │
│                                                             │
│  GPIO21 (SDA) ─┬─ ADS1015/ADS1115 @ 0x48 (S1–S4)          │
│  GPIO22 (SCL) ─┘─ ADS1115        @ 0x49 (S5–S8)           │
│                                                             │
│  GPIO26 ── BTN_NAV                                          │
│  GPIO25 ── BTN_SEL                                          │
│  GPIO27 ── BTN_BPMNAV                                       │
│  GPIO32 ── BTN_PITCHNAV                                     │
│                                                             │
│  GPIO34 ── POT_BPM   (ADC1 CH6)                             │
│  GPIO35 ── POT_PITCH (ADC1 CH7)                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Pin Assignment ESP32

### I2C

| ESP32 Pin | Fungsi  | Sambung ke              |
|-----------|---------|-------------------------|
| GPIO21    | SDA     | ADS1x15 SDA (semua chip) |
| GPIO22    | SCL     | ADS1x15 SCL (semua chip) |

### Button (Active LOW, Internal Pull-up)

| ESP32 Pin | Nama         | Fungsi                              |
|-----------|--------------|-------------------------------------|
| GPIO26    | BTN_NAV      | Navigate sensor (left/right)        |
| GPIO25    | BTN_SEL      | Select / confirm                    |
| GPIO27    | BTN_BPMNAV   | Cycle sensor pilihan BPM            |
| GPIO32    | BTN_PITCHNAV | Cycle sensor pilihan Pitch          |

Wiring button: `GPIO → Button → GND` (ESP32 internal pull-up aktif)

### Potentiometer (Analog Input)

| ESP32 Pin | Nama       | Fungsi              | Range Output |
|-----------|------------|---------------------|--------------|
| GPIO34    | POT_BPM    | Kawal BPM           | 40 – 200 BPM |
| GPIO35    | POT_PITCH  | Kawal Pitch (semitone) | -12 – +12 st |

Wiring potensio: `3.3V → POT (luar) → GPIO → POT (tengah/wiper) → GND → POT (luar)`

> **Penting:** GPIO34 & GPIO35 adalah input-only (tiada internal pull-up). Jangan guna sebagai output.

---

## ADS1x15 — Sensor Hall Effect

### Konfigurasi A (Default): ADS1015 + ADS1115

| Chip     | I2C Addr | ADDR Pin | Sensor | AIN Channel |
|----------|----------|----------|--------|-------------|
| ADS1015  | 0x48     | GND      | S1     | AIN0        |
| ADS1015  | 0x48     | GND      | S2     | AIN1        |
| ADS1015  | 0x48     | GND      | S3     | AIN2        |
| ADS1015  | 0x48     | GND      | S4     | AIN3        |
| ADS1115  | 0x49     | VCC      | S5     | AIN0        |
| ADS1115  | 0x49     | VCC      | S6     | AIN1        |
| ADS1115  | 0x49     | VCC      | S7     | AIN2        |
| ADS1115  | 0x49     | VCC      | S8     | AIN3        |

### Konfigurasi B (DUAL_ADS1115): 2× ADS1115

| Chip     | I2C Addr | ADDR Pin | Sensor | AIN Channel |
|----------|----------|----------|--------|-------------|
| ADS1115  | 0x48     | **GND**  | S1     | AIN0        |
| ADS1115  | 0x48     | **GND**  | S2     | AIN1        |
| ADS1115  | 0x48     | **GND**  | S3     | AIN2        |
| ADS1115  | 0x48     | **GND**  | S4     | AIN3        |
| ADS1115  | 0x49     | VCC      | S5     | AIN0        |
| ADS1115  | 0x49     | VCC      | S6     | AIN1        |
| ADS1115  | 0x49     | VCC      | S7     | AIN2        |
| ADS1115  | 0x49     | VCC      | S8     | AIN3        |

> **Penting (Konfigurasi B):** Kedua-dua chip ADDR pin MESTI berbeza. Chip pertama (S1–S4) ADDR → GND = 0x48. Chip kedua (S5–S8) ADDR → VCC = 0x49. Jika kedua-dua ADDR → VCC, alamat sama (collision) → chip 0x48 tidak ditemui.

### Wiring ADS1x15

```
3.3V ──── VDD
GND  ──── GND
GPIO21 ── SDA
GPIO22 ── SCL
GND/VCC ─ ADDR  (tentukan alamat I2C)
Hall OUT ─ AINx  (satu sensor per channel)
```

### Tetapan ADS

| Parameter    | Konfigurasi A (ADS1015) | Konfigurasi A (ADS1115) | Konfigurasi B (DUAL_ADS1115) |
|--------------|-------------------------|-------------------------|------------------------------|
| Gain         | GAIN_TWO (±2.048V)      | GAIN_TWO (±2.048V)      | GAIN_TWO (±2.048V)           |
| Resolusi     | 1 mV/count (12-bit)     | 0.0625 mV/count (16-bit)| 0.0625 mV/count (16-bit)     |
| Data Rate    | 1600 SPS                | 860 SPS                 | 860 SPS (kedua chip)         |

---

## Sensor Hall Effect (S1–S8)

| Sensor | Congkak | ADS Chip | AIN | hitDir | Keterangan                  |
|--------|---------|----------|-----|--------|-----------------------------|
| S1     | 1       | 0x48     | 0   | -1     | Magnet turunkan bacaan ADC  |
| S2     | 2       | 0x48     | 1   | +1     | Magnet naikkan bacaan ADC   |
| S3     | 3       | 0x48     | 2   | -1     | Magnet turunkan bacaan ADC  |
| S4     | 4       | 0x48     | 3   | +1     | Magnet naikkan bacaan ADC   |
| S5     | 5       | 0x49     | 0   | +1     | Magnet naikkan bacaan ADC   |
| S6     | 6       | 0x49     | 1   | -1     | Magnet turunkan bacaan ADC  |
| S7     | 7       | 0x49     | 2   | -1     | Magnet turunkan bacaan ADC  |
| S8     | 8       | 0x49     | 3   | -1     | Magnet turunkan bacaan ADC  |

`hitDir` menentukan arah gerakan magnet yang dianggap sebagai hit. Berbeza untuk setiap sensor bergantung pada orientasi magnet di hardware.

Wiring Hall sensor (3-pin tipikal):
```
3.3V ── VCC
GND  ── GND
AINx ── OUT  (output analog ke ADS channel)
```

---

## Threshold Sensitivity

### Konfigurasi A (ADS1015 untuk S1–S4)

| Level | S1–S4 (ADS1015) | S5–S8 (ADS1115) |
|-------|-----------------|-----------------|
| L1    | 80 counts       | 384 counts      |
| L2    | 130 counts      | 960 counts      |
| L3    | 180 counts      | 1920 counts     |
| L4    | 200 counts      | 3200 counts     |

### Konfigurasi B (DUAL_ADS1115, semua sensor)

| Level | Semua Sensor (ADS1115) |
|-------|------------------------|
| L1    | 384 counts             |
| L2    | 960 counts             |
| L3    | 1920 counts            |
| L4    | 3200 counts            |

---

## Serial Interface

| Parameter  | Nilai   |
|------------|---------|
| Baud rate  | 115200  |
| Format     | 8N1     |
| USB chip   | CP210x (Silicon Labs) |

### Command Serial

| Command      | Fungsi                                      |
|--------------|---------------------------------------------|
| `r`          | Recalibrate baseline (200 sample median)    |
| `s`          | Status — papar threshold & baseline semua sensor |
| `b`          | Simulasi tekan BTN_BPMNAV                   |
| `p<bpm>`     | Set BPM manual, contoh: `p150`              |
| `D<n><+\|->` | Tukar hitDir sensor n, contoh: `D6+`       |
| `T<n><l>=<v>`| Tukar threshold sensor n level l, contoh: `T31=300` |

### Format Output Serial

```
HALL8|adc1|dev1|led1|adc2|dev2|led2|...|adc8|dev8|led8
[BTN]NAV
[BTN]SEL
[BPMCTRL]<sensor>|<bpm>
[PITCHCTRL]<sensor>|<semitone>
[THRESH<n>] L1|L2|L3|L4 | dir=±1
[INIT S<n>] baseline=<val>
[CAL] ...
[READY]
```

---

## Keperluan Power

| Komponen    | Voltan | Nota                              |
|-------------|--------|-----------------------------------|
| ESP32       | 5V     | Via USB atau pin VIN              |
| ADS1x15     | 3.3V   | Dari pin 3V3 ESP32                |
| Hall sensor | 3.3V   | Dari pin 3V3 ESP32                |
| Potensio    | 3.3V   | Max ADC ESP32 = 3.3V              |
| Button      | —      | Pull-up dalaman ESP32, ke GND     |

---

## Flash Firmware

```bash
# Konfigurasi A (ADS1015 + ADS1115)
pio run -e esp32dev -t upload

# Konfigurasi B (2× ADS1115)
pio run -e esp32dev_dual1115 -t upload
```
