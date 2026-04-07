# ESP32 Drum Monitor — Firmware Guide (V2)

A beginner-friendly explanation of how the drum monitor firmware works.

---

## What Does This Firmware Do?

This firmware runs on an **ESP32 microcontroller** and turns it into a drum hit detector. It reads **8 Hall Effect sensors** (magnetic sensors) placed near drum heads. When you hit a drum, the vibration moves a small magnet near the sensor, and the firmware detects how hard you hit.

The firmware sends this information over a USB serial connection to a computer, where a web dashboard can visualize the hits in real time.

---

## Hardware Overview

### The Brain: ESP32

The ESP32 is a small, cheap computer-on-a-chip. It runs this firmware code in a loop, hundreds of times per second.

### The Sensors: Hall Effect Sensors (x8)

A Hall Effect sensor detects magnetic fields. A small magnet is attached near each drum head. When the drum is hit, the magnet moves closer or farther from the sensor, changing the magnetic field reading. The firmware reads this change to detect a hit.

### The ADC Chips: ADS1015 + ADS1115

The ESP32 cannot read the Hall sensors directly with enough precision, so two external **ADC (Analog-to-Digital Converter)** chips are used:

| Chip | I2C Address | Sensors | Resolution | Sensitivity |
|------|-------------|---------|------------|-------------|
| ADS1015 | 0x48 | S1 -- S4 | 12-bit (coarser) | 1 mV per count |
| ADS1115 | 0x49 | S5 -- S8 | 16-bit (finer) | 0.0625 mV per count |

Both chips share the same I2C bus (SDA = GPIO 21, SCL = GPIO 22).

### Buttons

| Button | GPIO Pin | Function |
|--------|----------|----------|
| NAV | 26 | Navigate to next sample |
| SEL | 25 | Confirm / save sample |
| BPM NAV | 27 | Cycle through sensors for BPM control |

All buttons use **active LOW** wiring with internal pull-up resistors. This means:
- **Not pressed** = reads HIGH (1)
- **Pressed** = reads LOW (0)

### Potentiometer (BPM Control)

| Component | GPIO Pin | Function |
|-----------|----------|----------|
| Potentiometer | 34 (ADC input) | Adjust BPM (40 -- 200) for selected sensor |

---

## How It Works: Step by Step

### 1. Power On (Setup)

When the ESP32 starts, the `setup()` function runs once:

1. **Serial communication starts** at 115200 baud (the speed of the USB data link).
2. **Button pins are configured** as inputs with internal pull-up resistors.
3. **I2C bus is initialized** for talking to the ADC chips.
4. **Both ADC chips are detected** and configured:
   - Gain is set to `GAIN_TWO` (range of +/-2.048V) for higher sensitivity.
   - Sample rates are set to reduce noise between channels.
5. **Baseline calibration runs** (see below).
6. **Threshold values are printed** to serial for debugging.
7. `[READY]` is printed -- the firmware is now running.

### 2. Baseline Calibration

**What is a baseline?** It is the "resting" sensor reading when no drum is being hit. Think of it as "zero" -- any reading above or below this is considered a hit.

**How it works:**
1. For each sensor, **200 readings** are taken (with 2ms between each).
2. The readings are **sorted** and the **middle value (median)** is picked.
3. This median becomes the baseline for that sensor.

**Why median instead of average?** If a random spike or glitch happens during calibration, an average would be thrown off. The median ignores outliers -- it always picks the most "typical" reading.

### 3. The Main Loop

After setup, the `loop()` function runs continuously. Each loop iteration does these steps:

#### Step 1: Check Buttons (every loop, ~0ms)

The firmware checks all three buttons every single loop. It uses **debouncing** -- if a button was pressed less than 80ms ago, new presses are ignored. This prevents a single physical press from registering multiple times (buttons "bounce" electrically when pressed).

When pressed:
- **NAV** --> sends `[BTN]NAV` over serial
- **SEL** --> sends `[BTN]SEL` over serial
- **BPM NAV** --> cycles to the next sensor for BPM control, sends `[BPMSEL]N`

#### Step 2: Read Sensors (every 2ms = 500 times/sec)

Every 2 milliseconds, all 8 sensors are read. But instead of sending every reading, the firmware does **peak detection**:

- It calculates the **deviation** (how far the reading is from baseline).
- If this deviation is **bigger** than the previously stored peak, it replaces it.
- This captures the **strongest hit** within each reporting window.

**Why peak detection?** A drum hit is a very fast event. If you only read at 50Hz (every 20ms), you might miss the peak of the hit. By reading at 500Hz but reporting at 50Hz, you catch the true peak.

#### Step 3: Send Data to Serial (every 20ms = 50 times/sec)

Every 20 milliseconds, the firmware:

1. **Computes the LED level** (hit intensity 0--4) for each sensor based on the peak deviation.
2. **Applies hysteresis** (see below).
3. **Sends one line** of data: `HALL8|adc1|dev1|led1|...|adc8|dev8|led8`
4. **Resets the peak** values back to zero, ready for the next 20ms window.

**The data format explained:**

```
HALL8|512|15|2|508|-3|0|520|30|3|505|0|0|2048|240|4|2030|10|1|2055|300|4|2040|5|0
      ^^^^^^^^^^^  ^^^^^^^^^^^  ...
      Sensor 1     Sensor 2
```

For each sensor, three values are sent:
- **adc** -- the raw ADC reading at peak
- **dev** -- how far from baseline (positive or negative)
- **led** -- the hit intensity level (0 = no hit, 1--4 = soft to hard)

#### Step 4: Send BPM Data (every 100ms)

Every 100 milliseconds, the firmware reads the potentiometer and sends: `[BPMCTRL]sensorIndex|bpmValue`

This tells the web dashboard which sensor is selected for BPM control and what BPM value the knob is set to (40--200).

#### Step 5: Check Serial Commands

The firmware listens for commands typed into the serial monitor:

| Command | Action |
|---------|--------|
| `r` | Re-run baseline calibration |
| `s` | Print status of all sensors (baseline + thresholds) |
| `T<sensor><level>=<value>` | Change a threshold (e.g., `T11=50` sets Sensor 1, Level 1 to 50) |

---

## Key Concepts Explained

### Thresholds and LED Levels

Each sensor has **4 threshold levels** that determine hit intensity:

| Level | Meaning | S1--S4 Default | S5--S8 Default |
|-------|---------|----------------|----------------|
| 0 | No hit (below level 1) | < 10 | < 80 |
| 1 | Light tap | 10 | 80 |
| 2 | Medium hit | 25 | 200 |
| 3 | Hard hit | 60 | 600 |
| 4 | Very hard hit | 120 | 1200 |

S5--S8 thresholds are ~10x higher because the ADS1115 has 16x finer resolution (more counts per millivolt).

The `computeLed()` function checks from the highest level down. If the absolute deviation exceeds a threshold, that level is returned.

### Hysteresis (False-Hit Prevention)

**Problem:** A sensor reading might flicker above and below a threshold for a split second, causing rapid on/off/on/off triggers.

**Solution:** The firmware requires **2 consecutive frames** (40ms) of consistent readings before changing state:

- To turn ON: the deviation must exceed the threshold for 2 frames in a row.
- To turn OFF: the deviation must be below the threshold for 2 frames in a row.

This filters out brief electrical noise and prevents "ghost" hits from neighboring sensors vibrating sympathetically (cross-trigger).

### Auto Re-Calibration

Over time, temperature changes or magnet drift can shift the baseline. Every **30 seconds**, the firmware checks:

1. Are ALL sensors currently idle (LED level = 0)?
2. If yes, take **20 readings** per sensor, sort them, and pick the median.
3. Only update the baseline if the new median is **within 200 counts** of the old one.

The 200-count guard prevents a resting magnet (placed on the sensor) from being absorbed into the baseline -- which would cause a false "hard hit" when the magnet is later removed.

### Non-Blocking Design

The firmware never uses `delay()` in the main loop (except the tiny delays during recalibration). Instead, it uses **timestamp comparison**:

```
if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    // do work
    lastSampleTime = now;
}
```

This means buttons, sensors, and serial commands are all checked without blocking each other. Nothing "waits" -- the loop runs as fast as possible, and each subsystem only acts when its timer is due.

---

## Wiring Diagram (Text)

```
ESP32                    ADS1015 (0x48)         ADS1115 (0x49)
------                   --------------         --------------
GPIO 21 (SDA) --------> SDA -----------------> SDA
GPIO 22 (SCL) --------> SCL -----------------> SCL
3.3V --------------------VDD -----------------> VDD
GND --------------------GND   ADDR-->GND       GND   ADDR-->VDD
                         A0 <-- Hall Sensor S1   A0 <-- Hall Sensor S5
                         A1 <-- Hall Sensor S2   A1 <-- Hall Sensor S6
                         A2 <-- Hall Sensor S3   A2 <-- Hall Sensor S7
                         A3 <-- Hall Sensor S4   A3 <-- Hall Sensor S8

ESP32
------
GPIO 25 <----[BTN SEL]-----> GND
GPIO 26 <----[BTN NAV]-----> GND
GPIO 27 <----[BTN BPMNAV]--> GND
GPIO 34 <----[POTENTIOMETER middle pin]
             [POT left pin]-----> GND
             [POT right pin]----> 3.3V
```

---

## Serial Protocol Reference

### Output Messages (Firmware --> Computer)

| Message | Frequency | Description |
|---------|-----------|-------------|
| `HALL8\|a\|d\|l\|...(x8)` | 50 Hz | Sensor data: adc, deviation, led for all 8 sensors |
| `[BTN]NAV` | On press | NAV button was pressed |
| `[BTN]SEL` | On press | SEL button was pressed |
| `[BPMSEL]N` | On press | BPM sensor selection changed to N (0--7) |
| `[BPMCTRL]sel\|bpm` | 10 Hz | Current BPM sensor and knob value |
| `[AUTO SN] baseline=X` | On recal | Sensor N baseline was auto-updated |
| `[INIT SN] baseline=X` | On boot | Sensor N initial baseline |
| `[THRESH N] a\|b\|c\|d` | On change | Sensor N threshold values |
| `[READY]` | Once | Firmware is initialized and running |
| `[ERR] ...` | On error | Hardware initialization failed |

### Input Commands (Computer --> Firmware)

| Command | Description |
|---------|-------------|
| `r` | Re-calibrate all sensor baselines |
| `s` | Print status (baselines + thresholds + button states) |
| `T<S><L>=<V>` | Set threshold: S=sensor(1-8), L=level(1-4), V=value |

**Threshold command examples:**
- `T11=50` -- Set Sensor 1, Level 1 threshold to 50
- `T34=100` -- Set Sensor 3, Level 4 threshold to 100
- `T52=300` -- Set Sensor 5, Level 2 threshold to 300

---

## Timing Summary

| Task | Interval | Rate |
|------|----------|------|
| Button polling | Every loop | ~500 Hz |
| Sensor reading + peak detection | 2 ms | 500 Hz |
| Serial data output | 20 ms | 50 Hz |
| BPM control output | 100 ms | 10 Hz |
| Auto baseline re-calibration | 30 s | When idle |
| Button debounce window | 80 ms | -- |
| Hysteresis confirmation | 2 frames (40 ms) | -- |

---

## Glossary

| Term | Definition |
|------|-----------|
| **ADC (Analog-to-Digital Converter)** | A chip that converts a continuous voltage (analog) into a number (digital) that a computer can understand. Higher resolution (more bits) means finer measurements. |
| **ADS1015** | A 12-bit ADC chip with 4 input channels. Each "count" represents about 1 mV at GAIN_TWO. Used for sensors S1--S4. |
| **ADS1115** | A 16-bit ADC chip with 4 input channels. Each "count" represents about 0.0625 mV at GAIN_TWO. More precise than ADS1015. Used for sensors S5--S8. |
| **Baseline** | The sensor's "resting" reading when no drum is being hit. All hit detection is measured as distance from this value. |
| **Baud rate** | The speed of serial communication, measured in bits per second. 115200 baud means 115,200 bits per second. |
| **BPM (Beats Per Minute)** | A measure of tempo in music. The potentiometer lets you set a BPM value (40--200) for a selected sensor. |
| **Cross-trigger** | When hitting one drum causes a neighboring sensor to falsely detect a hit due to vibration traveling through the drum kit. Hysteresis helps prevent this. |
| **Debounce** | A technique to prevent a single button press from being detected multiple times. When a physical button is pressed, the metal contacts "bounce" and create rapid on/off signals for a few milliseconds. Debouncing ignores these extra signals. |
| **Deviation (dev)** | The difference between the current sensor reading and the baseline. `dev = adc - baseline`. A positive or negative deviation indicates the magnet has moved. |
| **ESP32** | A low-cost microcontroller with Wi-Fi and Bluetooth, commonly used in IoT projects. It runs the firmware. |
| **Gain** | An amplification setting on the ADC. `GAIN_TWO` means the input voltage range is +/-2.048V, making the chip more sensitive to small voltage changes. |
| **GPIO (General Purpose Input/Output)** | Pins on the ESP32 that can be configured to read inputs (like buttons) or send outputs (like LEDs). |
| **Hall Effect sensor** | A sensor that detects magnetic fields. When a magnet moves near it, the output voltage changes. Named after physicist Edwin Hall. |
| **Hysteresis** | A technique where the system requires a consistent signal over multiple frames before changing state. Prevents flickering between on/off states due to noise. |
| **I2C (Inter-Integrated Circuit)** | A communication protocol that uses two wires (SDA for data, SCL for clock) to connect multiple chips together. Both ADC chips share the same I2C bus. |
| **LED level** | A number from 0 to 4 representing hit intensity. 0 = no hit, 4 = hardest hit. Named "LED" because it can directly drive LED indicators. |
| **Median** | The middle value in a sorted list. More resistant to outliers than an average. If you have readings [5, 5, 5, 100, 5], the average is 24 but the median is 5. |
| **Non-blocking** | A programming pattern where the code never waits/pauses. Instead of `delay(20)`, it checks "has 20ms passed since last time?" This allows multiple tasks to share the same loop. |
| **Outlier** | A reading that is far from the expected value, usually caused by electrical noise or interference. Median filtering removes outliers. |
| **Peak detection** | Recording the maximum value within a time window. Since drum hits are very fast events (~5ms), reading at 500Hz and reporting the peak at 50Hz ensures the true hit strength is captured. |
| **Potentiometer** | A variable resistor with a knob. Turning the knob changes the voltage read by the ESP32, which is mapped to a BPM value. |
| **Pull-up resistor** | A resistor that holds a pin at HIGH (3.3V) by default. When the button is pressed, it connects the pin to GND (LOW). The ESP32 has built-in pull-up resistors that can be enabled in software. |
| **SPS (Samples Per Second)** | How many times per second the ADC chip can take a reading. Higher SPS = faster but potentially noisier. |
| **Threshold** | A boundary value. If the deviation exceeds a threshold, a hit at that intensity level is registered. Each sensor has 4 threshold levels. |
