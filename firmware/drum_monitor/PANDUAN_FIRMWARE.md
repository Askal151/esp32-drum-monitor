# ESP32 Drum Monitor — Panduan Firmware (V2)

Penjelasan ramah pemula tentang cara kerja firmware drum monitor.

---

## Apa yang Dilakukan Firmware Ini?

Firmware ini berjalan di **mikrokontroler ESP32** dan mengubahnya menjadi pendeteksi pukulan drum. Firmware membaca **8 sensor Hall Effect** (sensor magnet) yang ditempatkan di dekat kepala drum. Ketika Anda memukul drum, getaran menggerakkan magnet kecil di dekat sensor, dan firmware mendeteksi seberapa keras pukulan Anda.

Firmware mengirimkan informasi ini melalui koneksi serial USB ke komputer, di mana dashboard web bisa menampilkan pukulan secara real-time.

---

## Gambaran Umum Perangkat Keras

### Otak: ESP32

ESP32 adalah komputer kecil dan murah dalam satu chip. Ia menjalankan kode firmware ini dalam sebuah loop, ratusan kali per detik.

### Sensor: Hall Effect Sensor (x8)

Sensor Hall Effect mendeteksi medan magnet. Magnet kecil dipasang di dekat setiap kepala drum. Ketika drum dipukul, magnet bergerak lebih dekat atau lebih jauh dari sensor, mengubah pembacaan medan magnet. Firmware membaca perubahan ini untuk mendeteksi pukulan.

### Chip ADC: ADS1015 + ADS1115

ESP32 tidak dapat membaca sensor Hall secara langsung dengan presisi yang cukup, jadi dua chip **ADC (Analog-to-Digital Converter / Pengubah Analog-ke-Digital)** eksternal digunakan:

| Chip | Alamat I2C | Sensor | Resolusi | Sensitivitas |
|------|------------|--------|----------|--------------|
| ADS1015 | 0x48 | S1 -- S4 | 12-bit (lebih kasar) | 1 mV per count |
| ADS1115 | 0x49 | S5 -- S8 | 16-bit (lebih halus) | 0.0625 mV per count |

Kedua chip berbagi bus I2C yang sama (SDA = GPIO 21, SCL = GPIO 22).

### Tombol

| Tombol | Pin GPIO | Fungsi |
|--------|----------|--------|
| NAV | 26 | Navigasi ke sample berikutnya |
| SEL | 25 | Konfirmasi / simpan sample |
| BPM NAV | 27 | Berpindah antar sensor untuk kontrol BPM |

Semua tombol menggunakan rangkaian **active LOW** dengan resistor pull-up internal. Artinya:
- **Tidak ditekan** = terbaca HIGH (1)
- **Ditekan** = terbaca LOW (0)

### Potensiometer (Kontrol BPM)

| Komponen | Pin GPIO | Fungsi |
|----------|----------|--------|
| Potensiometer | 34 (input ADC) | Atur BPM (40 -- 200) untuk sensor yang dipilih |

---

## Cara Kerjanya: Langkah Demi Langkah

### 1. Nyalakan Daya (Setup)

Ketika ESP32 mulai menyala, fungsi `setup()` berjalan sekali:

1. **Komunikasi serial dimulai** pada 115200 baud (kecepatan link data USB).
2. **Pin tombol dikonfigurasi** sebagai input dengan resistor pull-up internal.
3. **Bus I2C diinisialisasi** untuk berkomunikasi dengan chip ADC.
4. **Kedua chip ADC dideteksi** dan dikonfigurasi:
   - Gain diatur ke `GAIN_TWO` (rentang +/-2.048V) untuk sensitivitas lebih tinggi.
   - Sample rate diatur untuk mengurangi noise antar channel.
5. **Kalibrasi baseline dijalankan** (lihat di bawah).
6. **Nilai threshold dicetak** ke serial untuk debugging.
7. `[READY]` dicetak -- firmware sekarang berjalan.

### 2. Kalibrasi Baseline

**Apa itu baseline?** Baseline adalah pembacaan sensor dalam keadaan "istirahat" ketika tidak ada drum yang dipukul. Anggap saja sebagai "nol" -- pembacaan apa pun di atas atau di bawah nilai ini dianggap sebagai pukulan.

**Cara kerjanya:**
1. Untuk setiap sensor, **200 pembacaan** diambil (dengan jeda 2ms antar pembacaan).
2. Pembacaan **diurutkan** dan **nilai tengah (median)** dipilih.
3. Median ini menjadi baseline untuk sensor tersebut.

**Kenapa median, bukan rata-rata?** Jika lonjakan acak atau gangguan terjadi selama kalibrasi, rata-rata akan terpengaruh. Median mengabaikan outlier -- ia selalu memilih pembacaan paling "khas".

### 3. Loop Utama (Main Loop)

Setelah setup, fungsi `loop()` berjalan terus-menerus. Setiap putaran loop melakukan langkah-langkah berikut:

#### Langkah 1: Cek Tombol (setiap loop, ~0ms)

Firmware memeriksa ketiga tombol setiap putaran loop. Firmware menggunakan **debouncing** -- jika tombol ditekan kurang dari 80ms yang lalu, tekanan baru diabaikan. Ini mencegah satu tekanan fisik terdaftar berkali-kali (tombol "memantul" secara elektrik saat ditekan).

Saat ditekan:
- **NAV** --> mengirim `[BTN]NAV` melalui serial
- **SEL** --> mengirim `[BTN]SEL` melalui serial
- **BPM NAV** --> berpindah ke sensor berikutnya untuk kontrol BPM, mengirim `[BPMSEL]N`

#### Langkah 2: Baca Sensor (setiap 2ms = 500 kali/detik)

Setiap 2 milidetik, semua 8 sensor dibaca. Tapi alih-alih mengirim setiap pembacaan, firmware melakukan **deteksi puncak (peak detection)**:

- Firmware menghitung **deviasi** (seberapa jauh pembacaan dari baseline).
- Jika deviasi ini **lebih besar** dari puncak yang tersimpan sebelumnya, nilai tersebut diganti.
- Ini menangkap **pukulan terkuat** dalam setiap jendela pelaporan.

**Kenapa deteksi puncak?** Pukulan drum adalah kejadian yang sangat cepat. Jika Anda hanya membaca pada 50Hz (setiap 20ms), Anda mungkin melewatkan puncak pukulan. Dengan membaca pada 500Hz tapi melaporkan pada 50Hz, Anda menangkap puncak yang sebenarnya.

#### Langkah 3: Kirim Data ke Serial (setiap 20ms = 50 kali/detik)

Setiap 20 milidetik, firmware:

1. **Menghitung level LED** (intensitas pukulan 0--4) untuk setiap sensor berdasarkan deviasi puncak.
2. **Menerapkan histeresis** (lihat di bawah).
3. **Mengirim satu baris** data: `HALL8|adc1|dev1|led1|...|adc8|dev8|led8`
4. **Mereset puncak** kembali ke nol, siap untuk jendela 20ms berikutnya.

**Format data dijelaskan:**

```
HALL8|512|15|2|508|-3|0|520|30|3|505|0|0|2048|240|4|2030|10|1|2055|300|4|2040|5|0
      ^^^^^^^^^^^  ^^^^^^^^^^^  ...
      Sensor 1     Sensor 2
```

Untuk setiap sensor, tiga nilai dikirim:
- **adc** -- pembacaan ADC mentah pada puncak
- **dev** -- seberapa jauh dari baseline (positif atau negatif)
- **led** -- level intensitas pukulan (0 = tidak ada pukulan, 1--4 = lembut ke keras)

#### Langkah 4: Kirim Data BPM (setiap 100ms)

Setiap 100 milidetik, firmware membaca potensiometer dan mengirim: `[BPMCTRL]indeksSensor|nilaiBpm`

Ini memberi tahu dashboard web sensor mana yang dipilih untuk kontrol BPM dan berapa nilai BPM yang diatur oleh knob (40--200).

#### Langkah 5: Cek Perintah Serial

Firmware mendengarkan perintah yang diketik ke serial monitor:

| Perintah | Aksi |
|----------|------|
| `r` | Jalankan ulang kalibrasi baseline |
| `s` | Cetak status semua sensor (baseline + threshold) |
| `T<sensor><level>=<nilai>` | Ubah threshold (cth., `T11=50` atur Sensor 1, Level 1 ke 50) |

---

## Konsep Utama Dijelaskan

### Threshold dan Level LED

Setiap sensor punya **4 level threshold** yang menentukan intensitas pukulan:

| Level | Arti | Default S1--S4 | Default S5--S8 |
|-------|------|----------------|----------------|
| 0 | Tidak ada pukulan (di bawah level 1) | < 10 | < 80 |
| 1 | Ketukan ringan | 10 | 80 |
| 2 | Pukulan sedang | 25 | 200 |
| 3 | Pukulan keras | 60 | 600 |
| 4 | Pukulan sangat keras | 120 | 1200 |

Threshold S5--S8 sekitar ~10x lebih tinggi karena ADS1115 punya resolusi 16x lebih halus (lebih banyak count per milivolt).

Fungsi `computeLed()` memeriksa dari level tertinggi ke bawah. Jika deviasi absolut melebihi threshold, level tersebut dikembalikan.

### Histeresis (Pencegahan Pukulan Palsu)

**Masalah:** Pembacaan sensor mungkin berkedip-kedip di atas dan di bawah threshold untuk sesaat, menyebabkan pemicu hidup/mati/hidup/mati yang cepat.

**Solusi:** Firmware memerlukan **2 frame berturut-turut** (40ms) pembacaan yang konsisten sebelum mengubah keadaan:

- Untuk HIDUP: deviasi harus melebihi threshold selama 2 frame berturut-turut.
- Untuk MATI: deviasi harus di bawah threshold selama 2 frame berturut-turut.

Ini menyaring noise elektrik singkat dan mencegah pukulan "hantu" dari sensor tetangga yang bergetar secara simpatik (cross-trigger).

### Kalibrasi Ulang Otomatis

Seiring waktu, perubahan suhu atau pergeseran magnet bisa mengubah baseline. Setiap **30 detik**, firmware memeriksa:

1. Apakah SEMUA sensor sedang idle (level LED = 0)?
2. Jika ya, ambil **20 pembacaan** per sensor, urutkan, dan pilih median.
3. Hanya perbarui baseline jika median baru **dalam jarak 200 count** dari yang lama.

Pengaman 200-count mencegah magnet yang diam (diletakkan di atas sensor) terserap ke dalam baseline -- yang akan menyebabkan "pukulan keras" palsu ketika magnet kemudian diangkat.

### Desain Non-Blocking

Firmware tidak pernah menggunakan `delay()` di loop utama (kecuali delay kecil saat kalibrasi ulang). Sebaliknya, firmware menggunakan **perbandingan timestamp**:

```
if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    // lakukan kerja
    lastSampleTime = now;
}
```

Artinya tombol, sensor, dan perintah serial semuanya dicek tanpa saling memblokir. Tidak ada yang "menunggu" -- loop berjalan secepat mungkin, dan setiap subsistem hanya bertindak ketika timernya sudah waktunya.

---

## Diagram Pengkabelan (Teks)

```
ESP32                    ADS1015 (0x48)         ADS1115 (0x49)
------                   --------------         --------------
GPIO 21 (SDA) --------> SDA -----------------> SDA
GPIO 22 (SCL) --------> SCL -----------------> SCL
3.3V --------------------VDD -----------------> VDD
GND --------------------GND   ADDR-->GND       GND   ADDR-->VDD
                         A0 <-- Sensor Hall S1   A0 <-- Sensor Hall S5
                         A1 <-- Sensor Hall S2   A1 <-- Sensor Hall S6
                         A2 <-- Sensor Hall S3   A2 <-- Sensor Hall S7
                         A3 <-- Sensor Hall S4   A3 <-- Sensor Hall S8

ESP32
------
GPIO 25 <----[BTN SEL]-----> GND
GPIO 26 <----[BTN NAV]-----> GND
GPIO 27 <----[BTN BPMNAV]--> GND
GPIO 34 <----[POTENSIOMETER pin tengah]
             [POT pin kiri]-----> GND
             [POT pin kanan]----> 3.3V
```

---

## Referensi Protokol Serial

### Pesan Output (Firmware --> Komputer)

| Pesan | Frekuensi | Deskripsi |
|-------|-----------|-----------|
| `HALL8\|a\|d\|l\|...(x8)` | 50 Hz | Data sensor: adc, deviasi, led untuk semua 8 sensor |
| `[BTN]NAV` | Saat ditekan | Tombol NAV ditekan |
| `[BTN]SEL` | Saat ditekan | Tombol SEL ditekan |
| `[BPMSEL]N` | Saat ditekan | Pemilihan sensor BPM berubah ke N (0--7) |
| `[BPMCTRL]sel\|bpm` | 10 Hz | Sensor BPM saat ini dan nilai knob |
| `[AUTO SN] baseline=X` | Saat kalibrasi ulang | Baseline sensor N diperbarui secara otomatis |
| `[INIT SN] baseline=X` | Saat boot | Baseline awal sensor N |
| `[THRESH N] a\|b\|c\|d` | Saat berubah | Nilai threshold sensor N |
| `[READY]` | Sekali | Firmware telah diinisialisasi dan berjalan |
| `[ERR] ...` | Saat error | Inisialisasi perangkat keras gagal |

### Perintah Input (Komputer --> Firmware)

| Perintah | Deskripsi |
|----------|-----------|
| `r` | Kalibrasi ulang semua baseline sensor |
| `s` | Cetak status (baseline + threshold + keadaan tombol) |
| `T<S><L>=<N>` | Atur threshold: S=sensor(1-8), L=level(1-4), N=nilai |

**Contoh perintah threshold:**
- `T11=50` -- Atur Sensor 1, Level 1 threshold ke 50
- `T34=100` -- Atur Sensor 3, Level 4 threshold ke 100
- `T52=300` -- Atur Sensor 5, Level 2 threshold ke 300

---

## Ringkasan Waktu

| Tugas | Interval | Kecepatan |
|-------|----------|-----------|
| Polling tombol | Setiap loop | ~500 Hz |
| Pembacaan sensor + deteksi puncak | 2 ms | 500 Hz |
| Output data serial | 20 ms | 50 Hz |
| Output kontrol BPM | 100 ms | 10 Hz |
| Kalibrasi ulang baseline otomatis | 30 detik | Saat idle |
| Jendela debounce tombol | 80 ms | -- |
| Konfirmasi histeresis | 2 frame (40 ms) | -- |

---

## Glosari

| Istilah | Definisi |
|---------|----------|
| **ADC (Analog-to-Digital Converter)** | Chip yang mengubah tegangan kontinu (analog) menjadi angka (digital) yang bisa dipahami komputer. Resolusi lebih tinggi (lebih banyak bit) artinya pengukuran lebih halus. |
| **ADS1015** | Chip ADC 12-bit dengan 4 channel input. Setiap "count" mewakili sekitar 1 mV pada GAIN_TWO. Digunakan untuk sensor S1--S4. |
| **ADS1115** | Chip ADC 16-bit dengan 4 channel input. Setiap "count" mewakili sekitar 0.0625 mV pada GAIN_TWO. Lebih presisi dari ADS1015. Digunakan untuk sensor S5--S8. |
| **Baseline** | Pembacaan "istirahat" sensor ketika tidak ada drum yang dipukul. Semua deteksi pukulan diukur sebagai jarak dari nilai ini. |
| **Baud rate** | Kecepatan komunikasi serial, diukur dalam bit per detik. 115200 baud artinya 115.200 bit per detik. |
| **BPM (Beat Per Menit)** | Ukuran tempo dalam musik. Potensiometer memungkinkan Anda mengatur nilai BPM (40--200) untuk sensor yang dipilih. |
| **Cross-trigger** | Ketika memukul satu drum menyebabkan sensor tetangga mendeteksi pukulan palsu karena getaran yang merambat melalui kit drum. Histeresis membantu mencegah ini. |
| **Debounce** | Teknik untuk mencegah satu tekanan tombol terdeteksi berkali-kali. Saat tombol fisik ditekan, kontak logam "memantul" dan menghasilkan sinyal hidup/mati yang cepat selama beberapa milidetik. Debouncing mengabaikan sinyal tambahan ini. |
| **Deviasi (dev)** | Selisih antara pembacaan sensor saat ini dan baseline. `dev = adc - baseline`. Deviasi positif atau negatif menunjukkan magnet telah bergerak. |
| **ESP32** | Mikrokontroler biaya rendah dengan Wi-Fi dan Bluetooth, umum digunakan dalam proyek IoT. Chip ini menjalankan firmware. |
| **Firmware** | Perangkat lunak yang diprogram langsung ke dalam mikrokontroler. Tidak seperti aplikasi komputer biasa, firmware langsung berjalan saat chip dinyalakan. |
| **Gain** | Pengaturan penguatan pada ADC. `GAIN_TWO` artinya rentang tegangan input adalah +/-2.048V, membuat chip lebih sensitif terhadap perubahan tegangan kecil. |
| **GPIO (General Purpose Input/Output)** | Pin pada ESP32 yang bisa dikonfigurasi untuk membaca input (seperti tombol) atau mengirim output (seperti LED). |
| **Hall Effect sensor** | Sensor yang mendeteksi medan magnet. Ketika magnet bergerak di dekatnya, tegangan output berubah. Dinamai dari fisikawan Edwin Hall. |
| **Histeresis** | Teknik di mana sistem memerlukan sinyal yang konsisten selama beberapa frame sebelum mengubah keadaan. Mencegah berkedip-kedip antara keadaan hidup/mati karena noise. |
| **I2C (Inter-Integrated Circuit)** | Protokol komunikasi yang menggunakan dua kabel (SDA untuk data, SCL untuk clock) untuk menghubungkan beberapa chip bersama. Kedua chip ADC berbagi bus I2C yang sama. |
| **Kalibrasi** | Proses menetapkan titik referensi (baseline) untuk pengukuran. Seperti mengatur timbangan ke nol sebelum menimbang sesuatu. |
| **Level LED** | Angka dari 0 sampai 4 yang mewakili intensitas pukulan. 0 = tidak ada pukulan, 4 = pukulan paling keras. Dinamai "LED" karena bisa langsung menggerakkan indikator LED. |
| **Median** | Nilai tengah dalam daftar yang sudah diurutkan. Lebih tahan terhadap outlier dibandingkan rata-rata. Jika Anda punya pembacaan [5, 5, 5, 100, 5], rata-ratanya 24 tapi mediannya 5. |
| **Non-blocking** | Pola pemrograman di mana kode tidak pernah menunggu/berhenti. Alih-alih `delay(20)`, kode memeriksa "apakah 20ms sudah berlalu sejak terakhir kali?" Ini memungkinkan beberapa tugas berbagi loop yang sama. |
| **Noise (Kebisingan)** | Sinyal elektrik yang tidak diinginkan yang mengganggu pembacaan sensor. Bisa disebabkan oleh interferensi elektromagnetik, fluktuasi daya, atau komponen lain di sirkuit. |
| **Outlier** | Pembacaan yang jauh dari nilai yang diharapkan, biasanya disebabkan oleh noise elektrik atau gangguan. Penyaringan median menghilangkan outlier. |
| **Peak detection (Deteksi puncak)** | Merekam nilai maksimum dalam jendela waktu. Karena pukulan drum adalah kejadian yang sangat cepat (~5ms), membaca pada 500Hz dan melaporkan puncak pada 50Hz memastikan kekuatan pukulan sebenarnya tertangkap. |
| **Potensiometer** | Resistor variabel dengan knob. Memutar knob mengubah tegangan yang dibaca oleh ESP32, yang dipetakan menjadi nilai BPM. |
| **Pull-up resistor** | Resistor yang menahan pin pada HIGH (3.3V) secara default. Ketika tombol ditekan, pin terhubung ke GND (LOW). ESP32 punya resistor pull-up bawaan yang bisa diaktifkan melalui perangkat lunak. |
| **SPS (Samples Per Second)** | Berapa kali per detik chip ADC bisa mengambil pembacaan. SPS lebih tinggi = lebih cepat tapi berpotensi lebih berisik (noisy). |
| **Threshold (Ambang batas)** | Nilai batas. Jika deviasi melebihi threshold, pukulan pada level intensitas tersebut terdaftar. Setiap sensor punya 4 level threshold. |
