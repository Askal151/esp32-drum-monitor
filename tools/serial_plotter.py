"""
serial_plotter.py — Real-time PyQtGraph plotter untuk ESP32 Drum Monitor
Baca HALL8 dari /dev/ttyUSB0 @ 115200 dan plot dev + led 8 sensor secara langsung.
"""

import sys
import csv
import os
import time
import datetime
import serial
import numpy as np
from collections import deque

from PyQt5 import QtWidgets, QtCore, QtGui
import pyqtgraph as pg

SAVE_DIR = os.path.expanduser("~/drum_logs")

# ── Config ────────────────────────────────────────────────────────────────────
PORT       = "/dev/ttyUSB0"
BAUD       = 115200
HISTORY    = 200          # bilangan titik dalam graf (200 × 20ms = 4 saat)
NUM_S      = 8
UPDATE_MS  = 20           # refresh plot setiap 20ms (50Hz)

SENSOR_COLORS = [
    "#FF4444",   # S1 — merah
    "#FF8800",   # S2 — oren
    "#FFDD00",   # S3 — kuning
    "#44FF44",   # S4 — hijau
    "#00DDFF",   # S5 — cyan
    "#4488FF",   # S6 — biru
    "#AA44FF",   # S7 — ungu
    "#FF44AA",   # S8 — merah jambu
]

# ── Data store ────────────────────────────────────────────────────────────────
dev_buf = [deque([0.0] * HISTORY, maxlen=HISTORY) for _ in range(NUM_S)]
led_buf = [deque([0]   * HISTORY, maxlen=HISTORY) for _ in range(NUM_S)]
adc_buf = [deque([0.0] * HISTORY, maxlen=HISTORY) for _ in range(NUM_S)]

# State BPM, Pitch, latest led, button events
state = {
    "bpm_sel":   0,
    "bpm":       [120] * NUM_S,
    "pitch_sel": 0,
    "pitch":     [0]   * NUM_S,
    "led":       [0]   * NUM_S,
    "btn_nav":   0,
    "btn_sel":   0,
    "btn_bpmnav":   0,
    "btn_pitchnav": 0,
    "last_event": "",
}


# ── Serial reader (QThread) ───────────────────────────────────────────────────
class SerialReader(QtCore.QThread):
    new_data   = QtCore.pyqtSignal(list)   # [adc, dev, led] × 8
    ctrl_data  = QtCore.pyqtSignal(str)    # BPMCTRL / PITCHCTRL / BTN lines
    error_msg  = QtCore.pyqtSignal(str)

    def __init__(self, port, baud):
        super().__init__()
        self.port = port
        self.baud = baud
        self._running = True

    def run(self):
        try:
            ser = serial.Serial(self.port, self.baud, timeout=0.1)
        except Exception as e:
            self.error_msg.emit(str(e))
            return

        while self._running:
            try:
                raw = ser.readline()
                if not raw:
                    continue
                line = raw.decode("utf-8", errors="replace").strip()

                if line.startswith("HALL8|"):
                    parts = line.split("|")
                    if len(parts) == 25:
                        vals = []
                        for i in range(NUM_S):
                            base = 1 + i * 3
                            try:
                                adc = int(parts[base])
                                dev = int(parts[base + 1])
                                led = int(parts[base + 2])
                            except ValueError:
                                adc = dev = led = 0
                            vals.append((adc, dev, led))
                        self.new_data.emit(vals)
                else:
                    self.ctrl_data.emit(line)

            except Exception as e:
                self.error_msg.emit(str(e))
                break

        ser.close()

    def stop(self):
        self._running = False
        self.wait()


# ── Main Window ───────────────────────────────────────────────────────────────
class DrumPlotter(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("ESP32 Drum Monitor — Serial Plotter")
        self.resize(1400, 850)

        pg.setConfigOption("background", "#1a1a2e")
        pg.setConfigOption("foreground", "#e0e0e0")

        # ── Recording state ────────────────────────────────────────────────
        self._recording    = False
        self._rec_rows     = []    # list of dict, satu row per HALL8 frame
        self._rec_events   = []    # list of dict, satu row per event (BTN/CTRL)
        self._rec_start_ts = 0.0  # epoch saat record mula

        self._build_ui()
        self._start_serial()

        self.timer = QtCore.QTimer()
        self.timer.timeout.connect(self._refresh_plots)
        self.timer.start(UPDATE_MS)

    # ── UI ────────────────────────────────────────────────────────────────────
    def _build_ui(self):
        central = QtWidgets.QWidget()
        self.setCentralWidget(central)
        root = QtWidgets.QHBoxLayout(central)
        root.setSpacing(8)

        # ── Kiri: graf dev + graf led ──────────────────────────────────────
        left = QtWidgets.QVBoxLayout()
        root.addLayout(left, stretch=5)

        # Graf deviation (atas)
        self.pw_dev = pg.PlotWidget(title="Deviasi Sensor (ADC counts dari baseline)")
        self.pw_dev.showGrid(x=True, y=True, alpha=0.2)
        self.pw_dev.setLabel("left", "Deviasi")
        self.pw_dev.addLegend(offset=(10, 10))
        self.pw_dev.setYRange(-400, 400)
        left.addWidget(self.pw_dev, stretch=3)

        self.curves_dev = []
        for i in range(NUM_S):
            pen = pg.mkPen(color=SENSOR_COLORS[i], width=1.5)
            curve = self.pw_dev.plot(pen=pen, name=f"S{i+1}")
            self.curves_dev.append(curve)

        # Graf LED level (bawah)
        self.pw_led = pg.PlotWidget(title="LED Level (0=idle, 1–4=hit intensity)")
        self.pw_led.showGrid(x=True, y=True, alpha=0.2)
        self.pw_led.setLabel("left", "Level")
        self.pw_led.setYRange(-0.2, 4.5)
        self.pw_led.addLegend(offset=(10, 10))
        left.addWidget(self.pw_led, stretch=2)

        self.curves_led = []
        for i in range(NUM_S):
            pen = pg.mkPen(color=SENSOR_COLORS[i], width=2)
            curve = self.pw_led.plot(pen=pen, name=f"S{i+1}")
            self.curves_led.append(curve)

        # ── Kanan: panel status ────────────────────────────────────────────
        right = QtWidgets.QVBoxLayout()
        right.setSpacing(6)
        root.addLayout(right, stretch=2)

        # Sensor status grid
        grp_sensor = QtWidgets.QGroupBox("Status Sensor")
        grp_sensor.setStyleSheet("QGroupBox { color:#aaa; font-weight:bold; }")
        grid = QtWidgets.QGridLayout(grp_sensor)
        grid.setSpacing(4)

        headers = ["Sensor", "ADC", "Dev", "Level"]
        for c, h in enumerate(headers):
            lbl = QtWidgets.QLabel(h)
            lbl.setStyleSheet("color:#888; font-size:10px;")
            grid.addWidget(lbl, 0, c)

        self.lbl_adc   = []
        self.lbl_dev   = []
        self.lbl_level = []
        self.lbl_bar   = []

        for i in range(NUM_S):
            color = SENSOR_COLORS[i]
            name_lbl = QtWidgets.QLabel(f"S{i+1}")
            name_lbl.setStyleSheet(f"color:{color}; font-weight:bold;")
            grid.addWidget(name_lbl, i+1, 0)

            adc_lbl = QtWidgets.QLabel("0")
            adc_lbl.setStyleSheet("color:#ccc; font-family:monospace;")
            grid.addWidget(adc_lbl, i+1, 1)
            self.lbl_adc.append(adc_lbl)

            dev_lbl = QtWidgets.QLabel("0")
            dev_lbl.setStyleSheet("color:#ccc; font-family:monospace;")
            grid.addWidget(dev_lbl, i+1, 2)
            self.lbl_dev.append(dev_lbl)

            lv_lbl = QtWidgets.QLabel("—")
            lv_lbl.setStyleSheet("color:#ccc; font-family:monospace; font-weight:bold;")
            grid.addWidget(lv_lbl, i+1, 3)
            self.lbl_level.append(lv_lbl)

        right.addWidget(grp_sensor)

        # BPM / Pitch panel
        grp_ctrl = QtWidgets.QGroupBox("BPM & Pitch Control")
        grp_ctrl.setStyleSheet("QGroupBox { color:#aaa; font-weight:bold; }")
        ctrl_grid = QtWidgets.QGridLayout(grp_ctrl)

        self.lbl_bpm_sel   = QtWidgets.QLabel("S1")
        self.lbl_bpm_val   = QtWidgets.QLabel("120 BPM")
        self.lbl_pitch_sel = QtWidgets.QLabel("S1")
        self.lbl_pitch_val = QtWidgets.QLabel("0 semitone")

        for lbl in [self.lbl_bpm_sel, self.lbl_bpm_val,
                    self.lbl_pitch_sel, self.lbl_pitch_val]:
            lbl.setStyleSheet("color:#0ff; font-family:monospace; font-size:13px;")

        ctrl_grid.addWidget(QtWidgets.QLabel("BPM sensor:"),  0, 0)
        ctrl_grid.addWidget(self.lbl_bpm_sel,                 0, 1)
        ctrl_grid.addWidget(QtWidgets.QLabel("BPM:"),         1, 0)
        ctrl_grid.addWidget(self.lbl_bpm_val,                 1, 1)
        ctrl_grid.addWidget(QtWidgets.QLabel("Pitch sensor:"),2, 0)
        ctrl_grid.addWidget(self.lbl_pitch_sel,               2, 1)
        ctrl_grid.addWidget(QtWidgets.QLabel("Pitch:"),       3, 0)
        ctrl_grid.addWidget(self.lbl_pitch_val,               3, 1)

        right.addWidget(grp_ctrl)

        # Button status
        grp_btn = QtWidgets.QGroupBox("Button Events")
        grp_btn.setStyleSheet("QGroupBox { color:#aaa; font-weight:bold; }")
        btn_grid = QtWidgets.QGridLayout(grp_btn)

        self.lbl_btn = {}
        btns = [("NAV",      "GPIO 26"),
                ("SEL",      "GPIO 25"),
                ("BPMNAV",   "GPIO 27"),
                ("PITCHNAV", "GPIO 32")]
        for r, (name, pin) in enumerate(btns):
            lbl_name = QtWidgets.QLabel(f"{name} ({pin})")
            lbl_name.setStyleSheet("color:#888; font-size:11px;")
            lbl_count = QtWidgets.QLabel("0×")
            lbl_count.setStyleSheet("color:#555; font-family:monospace; font-weight:bold;")
            btn_grid.addWidget(lbl_name,  r, 0)
            btn_grid.addWidget(lbl_count, r, 1)
            self.lbl_btn[name] = lbl_count

        right.addWidget(grp_btn)

        # Event log
        grp_log = QtWidgets.QGroupBox("Event Log")
        grp_log.setStyleSheet("QGroupBox { color:#aaa; font-weight:bold; }")
        log_layout = QtWidgets.QVBoxLayout(grp_log)
        self.log_box = QtWidgets.QPlainTextEdit()
        self.log_box.setReadOnly(True)
        self.log_box.setMaximumBlockCount(80)
        self.log_box.setStyleSheet(
            "background:#0d0d1a; color:#88ff88; font-family:monospace; font-size:10px;")
        log_layout.addWidget(self.log_box)
        right.addWidget(grp_log, stretch=1)

        # ── Record panel ───────────────────────────────────────────────────
        grp_rec = QtWidgets.QGroupBox("Record & Export CSV")
        grp_rec.setStyleSheet("QGroupBox { color:#aaa; font-weight:bold; }")
        rec_layout = QtWidgets.QVBoxLayout(grp_rec)
        rec_layout.setSpacing(4)

        # Baris 1: butang REC + STOP
        rec_row1 = QtWidgets.QHBoxLayout()
        self.btn_rec = QtWidgets.QPushButton("● REC")
        self.btn_rec.setCheckable(True)
        self.btn_rec.setStyleSheet("""
            QPushButton {
                background:#1a1a2e; color:#ff4444; border:1px solid #ff4444;
                border-radius:4px; padding:5px 12px; font-weight:bold; font-size:13px;
            }
            QPushButton:checked {
                background:#ff2222; color:#fff; border:1px solid #ff6666;
            }
        """)
        self.btn_rec.clicked.connect(self._toggle_record)
        rec_row1.addWidget(self.btn_rec)

        self.btn_save = QtWidgets.QPushButton("💾 Simpan CSV")
        self.btn_save.setEnabled(False)
        self.btn_save.setStyleSheet("""
            QPushButton {
                background:#1a1a2e; color:#44aaff; border:1px solid #44aaff;
                border-radius:4px; padding:5px 12px; font-size:12px;
            }
            QPushButton:disabled { color:#333; border-color:#333; }
            QPushButton:hover:!disabled { background:#1a3355; }
        """)
        self.btn_save.clicked.connect(self._save_csv)
        rec_row1.addWidget(self.btn_save)
        rec_layout.addLayout(rec_row1)

        # Baris 2: status recording
        self.lbl_rec_status = QtWidgets.QLabel("Sedia untuk record")
        self.lbl_rec_status.setStyleSheet("color:#666; font-size:11px;")
        rec_layout.addWidget(self.lbl_rec_status)

        # Baris 3: row count + duration
        rec_row3 = QtWidgets.QHBoxLayout()
        self.lbl_rec_rows  = QtWidgets.QLabel("0 baris")
        self.lbl_rec_dur   = QtWidgets.QLabel("00:00")
        for lbl in [self.lbl_rec_rows, self.lbl_rec_dur]:
            lbl.setStyleSheet("color:#888; font-family:monospace; font-size:11px;")
        rec_row3.addWidget(self.lbl_rec_rows)
        rec_row3.addStretch()
        rec_row3.addWidget(self.lbl_rec_dur)
        rec_layout.addLayout(rec_row3)

        # Baris 4: path simpan terakhir
        self.lbl_rec_path = QtWidgets.QLabel("—")
        self.lbl_rec_path.setStyleSheet(
            "color:#446688; font-size:9px; font-family:monospace;")
        self.lbl_rec_path.setWordWrap(True)
        rec_layout.addWidget(self.lbl_rec_path)

        right.addWidget(grp_rec)

        # Status bar
        self.status_lbl = QtWidgets.QLabel("Menghubung ke " + PORT + "...")
        self.statusBar().addWidget(self.status_lbl)

        # Styling keseluruhan
        self.setStyleSheet("""
            QMainWindow, QWidget { background:#1a1a2e; color:#e0e0e0; }
            QGroupBox { border:1px solid #333; border-radius:4px;
                        margin-top:6px; padding:6px; }
            QLabel { font-size:12px; }
        """)

    # ── Serial ────────────────────────────────────────────────────────────────
    def _start_serial(self):
        self.reader = SerialReader(PORT, BAUD)
        self.reader.new_data.connect(self._on_hall_data)
        self.reader.ctrl_data.connect(self._on_ctrl_data)
        self.reader.error_msg.connect(self._on_error)
        self.reader.start()

    def _on_hall_data(self, vals):
        for i, (adc, dev, led) in enumerate(vals):
            adc_buf[i].append(float(adc))
            dev_buf[i].append(float(dev))
            led_buf[i].append(led)
            state["led"][i] = led

        if self._recording:
            elapsed_ms = int((time.time() - self._rec_start_ts) * 1000)
            row = {"timestamp_ms": elapsed_ms}
            for i, (adc, dev, led) in enumerate(vals):
                row[f"S{i+1}_adc"] = adc
                row[f"S{i+1}_dev"] = dev
                row[f"S{i+1}_led"] = led
            self._rec_rows.append(row)

    def _on_ctrl_data(self, line):
        if line.startswith("[BPMCTRL]"):
            parts = line[9:].split("|")
            if len(parts) == 2:
                sel, val = int(parts[0]), int(parts[1])
                state["bpm_sel"] = sel
                state["bpm"][sel] = val
                self.lbl_bpm_sel.setText(f"S{sel+1}")
                self.lbl_bpm_val.setText(f"{val} BPM")
                cnt = int(self.lbl_btn["BPMNAV"].text().replace("×","")) + 1
                self.lbl_btn["BPMNAV"].setText(f"{cnt}×")
                self.lbl_btn["BPMNAV"].setStyleSheet(
                    "color:#ffaa00; font-family:monospace; font-weight:bold;")
                self._log(line)

        elif line.startswith("[PITCHCTRL]"):
            parts = line[11:].split("|")
            if len(parts) == 2:
                sel, val = int(parts[0]), int(parts[1])
                state["pitch_sel"] = sel
                state["pitch"][sel] = val
                self.lbl_pitch_sel.setText(f"S{sel+1}")
                sign = "+" if val >= 0 else ""
                self.lbl_pitch_val.setText(f"{sign}{val} semitone")
                cnt = int(self.lbl_btn["PITCHNAV"].text().replace("×","")) + 1
                self.lbl_btn["PITCHNAV"].setText(f"{cnt}×")
                self.lbl_btn["PITCHNAV"].setStyleSheet(
                    "color:#ffaa00; font-family:monospace; font-weight:bold;")
                self._log(line)

        elif line == "[BTN]NAV":
            cnt = int(self.lbl_btn["NAV"].text().replace("×","")) + 1
            self.lbl_btn["NAV"].setText(f"{cnt}×")
            self.lbl_btn["NAV"].setStyleSheet(
                "color:#00ff88; font-family:monospace; font-weight:bold;")
            self._log("[BTN] NAV ditekan")

        elif line == "[BTN]SEL":
            cnt = int(self.lbl_btn["SEL"].text().replace("×","")) + 1
            self.lbl_btn["SEL"].setText(f"{cnt}×")
            self.lbl_btn["SEL"].setStyleSheet(
                "color:#00ff88; font-family:monospace; font-weight:bold;")
            self._log("[BTN] SEL ditekan")

        elif line.startswith("[ERR]") or line.startswith("[CAL]") or line.startswith("[READY]"):
            self._log(line)

        if self._recording and line:
            elapsed_ms = int((time.time() - self._rec_start_ts) * 1000)
            self._rec_events.append({
                "timestamp_ms": elapsed_ms,
                "event": line,
            })

    def _on_error(self, msg):
        self.status_lbl.setText(f"ERROR: {msg}")
        self._log(f"[ERR] {msg}")

    # ── Record controls ───────────────────────────────────────────────────────
    def _toggle_record(self, checked):
        if checked:
            self._recording    = True
            self._rec_rows     = []
            self._rec_events   = []
            self._rec_start_ts = time.time()
            self.btn_rec.setText("■ STOP")
            self.btn_save.setEnabled(False)
            self.lbl_rec_status.setStyleSheet("color:#ff4444; font-size:11px;")
            self.lbl_rec_status.setText("⏺ Sedang merekod...")
            self._log("[REC] Mula rekod")
        else:
            self._recording = False
            self.btn_rec.setText("● REC")
            self.btn_save.setEnabled(len(self._rec_rows) > 0)
            n = len(self._rec_rows)
            dur = int(time.time() - self._rec_start_ts)
            self.lbl_rec_status.setStyleSheet("color:#44ff88; font-size:11px;")
            self.lbl_rec_status.setText(f"✓ Selesai — {n} baris, {dur}s")
            self._log(f"[REC] Berhenti — {n} baris direkod")
            # Auto-save terus
            self._save_csv(auto=True)

    def _save_csv(self, auto=False):
        if not self._rec_rows:
            QtWidgets.QMessageBox.warning(self, "Tiada Data", "Tiada rekod untuk disimpan.")
            return

        os.makedirs(SAVE_DIR, exist_ok=True)
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        default_name = os.path.join(SAVE_DIR, f"drum_log_{ts}.csv")

        if auto:
            path = default_name
        else:
            path, _ = QtWidgets.QFileDialog.getSaveFileName(
                self, "Simpan CSV", default_name,
                "CSV Files (*.csv);;All Files (*)")
            if not path:
                return

        # Tulis CSV sensor
        fieldnames = ["timestamp_ms"]
        for i in range(NUM_S):
            fieldnames += [f"S{i+1}_adc", f"S{i+1}_dev", f"S{i+1}_led"]

        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(self._rec_rows)

        # Tulis CSV events (jika ada)
        if self._rec_events:
            ev_path = path.replace(".csv", "_events.csv")
            with open(ev_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=["timestamp_ms", "event"])
                writer.writeheader()
                writer.writerows(self._rec_events)
            self._log(f"[CSV] Events: {os.path.basename(ev_path)}")

        self.lbl_rec_path.setText(path)
        self._log(f"[CSV] Disimpan: {os.path.basename(path)} ({len(self._rec_rows)} baris)")

    # ── Plot refresh ──────────────────────────────────────────────────────────
    def _refresh_plots(self):
        x = np.arange(HISTORY)

        for i in range(NUM_S):
            self.curves_dev[i].setData(x, list(dev_buf[i]))
            self.curves_led[i].setData(x, list(led_buf[i]))

            adc_val = adc_buf[i][-1] if adc_buf[i] else 0
            dev_val = dev_buf[i][-1] if dev_buf[i] else 0
            led_val = state["led"][i]

            self.lbl_adc[i].setText(f"{int(adc_val)}")
            self.lbl_dev[i].setText(f"{int(dev_val):+d}")

            # Warnakan level
            if led_val == 0:
                color, text = "#555", "—"
            elif led_val == 1:
                color, text = "#88ff88", "● 1"
            elif led_val == 2:
                color, text = "#ffdd00", "●● 2"
            elif led_val == 3:
                color, text = "#ff8800", "●●● 3"
            else:
                color, text = "#ff4444", "●●●● 4"

            self.lbl_level[i].setText(text)
            self.lbl_level[i].setStyleSheet(
                f"color:{color}; font-family:monospace; font-weight:bold;")

        # Update recording counter + durasi
        if self._recording:
            elapsed = int(time.time() - self._rec_start_ts)
            mins, secs = divmod(elapsed, 60)
            self.lbl_rec_dur.setText(f"{mins:02d}:{secs:02d}")
            self.lbl_rec_rows.setText(f"{len(self._rec_rows):,} baris")

        self.status_lbl.setText(
            f"● LIVE — {PORT} @ {BAUD} baud  |  "
            f"BPM sel=S{state['bpm_sel']+1} {state['bpm'][state['bpm_sel']]}BPM  |  "
            f"Pitch sel=S{state['pitch_sel']+1} {state['pitch'][state['pitch_sel']]:+d}st"
            + ("  |  ⏺ REC" if self._recording else ""))

    def _log(self, msg):
        self.log_box.appendPlainText(msg)

    def closeEvent(self, event):
        self.reader.stop()
        event.accept()


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app = QtWidgets.QApplication(sys.argv)
    app.setApplicationName("Drum Monitor Plotter")
    win = DrumPlotter()
    win.show()
    sys.exit(app.exec_())
