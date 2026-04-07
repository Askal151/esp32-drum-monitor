# ESP32 Drum Monitor — Makefile
# Firmware (PlatformIO) + Frontend (Svelte/Vite)

FIRMWARE_DIR = firmware/drum_monitor
MONITOR_SPEED = 115200

# ─── Frontend ────────────────────────────────────────────────

.PHONY: install dev build preview

install:                ## Install frontend dependencies
	npm install

dev:                    ## Run frontend dev server (port 5174)
	npm run dev

build:                  ## Build frontend for production
	npm run build

preview:                ## Preview production build
	npm run preview

# ─── Firmware ────────────────────────────────────────────────

.PHONY: firmware upload monitor clean-firmware

firmware:               ## Compile firmware
	cd $(FIRMWARE_DIR) && pio run

upload:                 ## Compile and upload firmware to ESP32
	cd $(FIRMWARE_DIR) && pio run -t upload

monitor:                ## Open serial monitor
	cd $(FIRMWARE_DIR) && pio device monitor -b $(MONITOR_SPEED)

flash-monitor: upload   ## Upload firmware then open serial monitor
	cd $(FIRMWARE_DIR) && pio device monitor -b $(MONITOR_SPEED)

clean-firmware:         ## Clean firmware build artifacts
	cd $(FIRMWARE_DIR) && pio run -t clean

# ─── Utilities ───────────────────────────────────────────────

.PHONY: clean help

clean: clean-firmware   ## Clean all build artifacts
	rm -rf dist node_modules/.vite

help:                   ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
