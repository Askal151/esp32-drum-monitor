# ESP32 Drum Monitor

Monitor drum berbasis sensor Hall Effect dengan 8 channel, Web Serial API, dan beat sequencer 30 genre.

## Perkakasan

| Komponen | Butiran |
|----------|---------|
| MCU | ESP32 |
| ADC 1 | ADS1015 @ 0x48 — Sensor S1–S4 (12-bit) |
| ADC 2 | ADS1115 @ 0x49 — Sensor S5–S8 (16-bit) |
| Sensor | 8× Hall Effect SS49E |
| Button | NAV (GPIO 26), SEL (GPIO 25) |
| I2C | SDA=21, SCL=22 |

## Cara Jalankan (Web Monitor)

### 1. Clone dan install

```bash
git clone https://github.com/Askal151/esp32-drum-monitor.git
cd esp32-drum-monitor
npm install
```

### 2. Jalankan dev server

```bash
npm run dev
```

Buka browser: `http://localhost:5173/esp32-drum-monitor/`

> Gunakan **Chrome** atau **Edge** — Web Serial API tidak disokong Firefox/Safari.

### 3. Sambung ESP32

1. Flash firmware dari folder `firmware/drum_monitor/`
2. Klik butang **⚡ Sambung** di UI
3. Pilih port COM / ttyUSB ESP32
4. Klik **⚠ Aktifkan Audio** apabila diminta

## Cara Jalankan (Production Build)

```bash
npm run build
npm run preview
```

Buka: `http://localhost:5174/esp32-drum-monitor/`

## Flash Firmware ESP32

```bash
# Guna Arduino IDE atau PlatformIO
# Buka: firmware/drum_monitor/drum_monitor.ino
# Board: ESP32 Dev Module
# Baud upload: 115200
```

## Ciri-ciri

- **8 sensor Hall Effect** — baca secara serentak via ADS1015 + ADS1115
- **Beat sequencer 16-step** — 30 pola beat semua genre dengan dinamik velocity
- **Assign beat per sensor** — setiap sensor boleh main beat berbeza secara serentak
- **Auto-calibration** — baseline median 200 sample + auto-recal 30 saat
- **Web Serial** — sambung terus dari browser tanpa driver tambahan
- **Waveform real-time** — paparan ADC rolling 60fps

## Genre Beat (30 pola)

| Genre | Beat |
|-------|------|
| Techno | Basic, Industrial, Minimal |
| Electronic | House Classic, Glitch Beat |
| Breakbeat | Drum & Bass, Jungle Break, Amen Break |
| Hip Hop | Boom Bap, Trap 808 |
| Nusantara | Batak, Jawa, Melayu, Bedug, Sunda, Betawi, Batak-House |
| Latin | Conga, Samba, Bossa Nova |
| Rock/Pop/Funk | Rock Basic, Pop Dance, Funk Groove |
| World | Tribal, Afrobeat, Reggae/Ska |
| Fusion | Jazz Breakbeat, Tropical Fusion |
| Ambient | Sparse |
| WAV | Percusion 123 (custom) |

## Struktur Projek

```
esp32-drum-monitor/
├── firmware/
│   └── drum_monitor/
│       └── drum_monitor.ino   # Kod ESP32
├── src/
│   ├── App.svelte             # UI utama + beat sequencer engine
│   └── lib/
│       ├── audio.js           # Web Audio API — semua bunyi instrumen
│       ├── sampleStore.js     # BEAT_DATA (30 pola) + state machine
│       ├── serial.js          # Web Serial parser
│       ├── Waveform.svelte    # Rolling waveform canvas
│       ├── SampleAssign.svelte
│       └── SamplePicker.svelte
├── public/
│   └── samples/
│       └── percusion123.wav   # WAV custom
└── package.json
```

## Serial Protocol

```
HALL8|adc1|dev1|led1|...|adc8|dev8|led8   (24 nilai, 50Hz)
[BTN]NAV   — button NAV ditekan
[BTN]SEL   — button SEL ditekan
```

## Threshold Default

| Sensor | Level 1 | Level 2 | Level 3 | Level 4 |
|--------|---------|---------|---------|---------|
| S1–S4 (ADS1015) | 10 | 25 | 60 | 120 |
| S5–S8 (ADS1115) | 80 | 200 | 600 | 1200 |
