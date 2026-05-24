#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <math.h>
//#include <esp_task_wdt.h>
#define DHTPIN     4
#define DHTTYPE    DHT22
#define MQ2_PIN    34
#define LDR_PIN    35
#define NOISE_PIN  32
#define RELAY_PIN  26
//#define WDT_TIMEOUT_SEC  10
const char* ssid        = "Wokwi-GUEST";
const char* password    = "";
const char* mqtt_server = "broker.hivemq.com";
const int   mqtt_port   = 1883;
const char* topicRoom   = "smartcampus/demo1/room";

WiFiClient   espClient;
PubSubClient mqttClient(espClient);
DHT          dht(DHTPIN, DHTTYPE);
static const float FUSION_ON_THR   = 62.0f;   // fusion harus > ini agar relay ON kembali
static const float FUSION_OFF_THR  = 48.0f;   // fusion < ini → relay dimatikan
static const int   GAS_CRITICAL    = 65;       // % (skala 0-100)
static const float TEMP_CRITICAL   = 33.0f;   // °C

// ── Shared data (mutex-protected) ────────────────────────────────────────────
SemaphoreHandle_t xDataMutex;

struct RoomData {
  float temp        = 27.0f;
  float hum         = 55.0f;
  int   gas         = 0;
  int   light       = 50;
  int   noise       = 0;
  float fusionScore = 100.0f;
  bool  relayState  = true;
  bool  criticalCut = false;
  bool  valid       = false;   // false sampai pembacaan pertama berhasil
};

static RoomData g_room;

// relay state disimpan di luar struct supaya hysteresis tidak di-reset mutex
static bool g_relayState = true;

// ── Helpers ──────────────────────────────────────────────────────────────────
static float clampF(float v, float lo, float hi) {
  return (v < lo) ? lo : (v > hi) ? hi : v;
}

// ── Task: Sensor ─────────────────────────────────────────────────────────────
void taskSensor(void* /*pvParams*/) {
 // esp_task_wdt_add(NULL);

  const TickType_t period   = pdMS_TO_TICKS(500);   // baca sensor tiap 500 ms
  TickType_t       lastWake = xTaskGetTickCount();

  while (true) {
   // esp_task_wdt_reset();
    float t = dht.readTemperature();
    float h = dht.readHumidity();

    if (isnan(t) || isnan(h)) {
      // Sensor error → relay paksa mati, tandai critical
      if (xSemaphoreTake(xDataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        g_room.relayState  = false;
        g_room.criticalCut = true;
        xSemaphoreGive(xDataMutex);
      }
      digitalWrite(RELAY_PIN, LOW);
      vTaskDelayUntil(&lastWake, period);
      continue;
    }

    // ── Analog sensors ────────────────────────────────────────────────────
    int mqRaw    = analogRead(MQ2_PIN);
    int lightRaw = analogRead(LDR_PIN);
    int noiseRaw = analogRead(NOISE_PIN);

    // Gas  → nilai tinggi = banyak gas (langsung)
    int gas = map(mqRaw, 0, 4095, 0, 100);

    // LDR  → rangkaian pull-up: raw TINGGI = GELAP, raw RENDAH = TERANG
    //        Invert agar nilai tinggi = lebih terang (konsisten dengan logika skor)
    int light = 100 - map(lightRaw, 0, 4095, 0, 100);

    // Noise → nilai tinggi = berisik (langsung)
    int noise = map(noiseRaw, 0, 4095, 0, 100);

    // ── Per-parameter comfort score (0–100) ───────────────────────────────
    // Suhu ideal  26 °C ± toleransi (turun 8 poin per derajat dari ideal)
    float tempScore  = clampF(100.0f - fabsf(t  - 26.0f) * 8.0f,       0.0f, 100.0f);
    // Kelembaban ideal 55 % RH (turun 1.5 poin per persen dari ideal)
    float humScore   = clampF(100.0f - fabsf(h  - 55.0f) * 1.5f,       0.0f, 100.0f);
    // Gas: makin tinggi makin buruk
    float gasScore   = clampF(100.0f - (float)gas   * 1.2f,             0.0f, 100.0f);
    // Cahaya ideal 55 % (turun 1.2 poin per unit dari ideal)
    float lightScore = clampF(100.0f - fabsf((float)light - 55.0f) * 1.2f, 0.0f, 100.0f);
    // Kebisingan: makin tinggi makin buruk
    float noiseScore = clampF(100.0f - (float)noise  * 1.0f,            0.0f, 100.0f);

    // ── Weighted fusion (bobot total = 1.0) ───────────────────────────────
    // Gas dan suhu diberi bobot lebih besar karena berdampak pada keselamatan.
    float fusion =
        0.30f * tempScore   +   // suhu paling kritis
        0.30f * gasScore    +   // gas (keamanan/kualitas udara)
        0.15f * humScore    +
        0.15f * lightScore  +
        0.10f * noiseScore;

    // ── Relay decision ────────────────────────────────────────────────────
    bool critical = (gas >= GAS_CRITICAL) || (t >= TEMP_CRITICAL);

    if (critical) {
      g_relayState = false;
    } else {
      // Hysteresis: relay tidak flicker di sekitar threshold
      if ( g_relayState && fusion < FUSION_OFF_THR) g_relayState = false;
      if (!g_relayState && fusion > FUSION_ON_THR)  g_relayState = true;
    }

    digitalWrite(RELAY_PIN, g_relayState ? HIGH : LOW);

    // ── Update shared state ───────────────────────────────────────────────
    if (xSemaphoreTake(xDataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      g_room.temp        = t;
      g_room.hum         = h;
      g_room.gas         = gas;
      g_room.light       = light;
      g_room.noise       = noise;
      g_room.fusionScore = fusion;
      g_room.relayState  = g_relayState;
      g_room.criticalCut = critical;
      g_room.valid       = true;
      xSemaphoreGive(xDataMutex);
    }

    vTaskDelayUntil(&lastWake, period);
  }
}

// ── Task: MQTT ───────────────────────────────────────────────────────────────
static void mqttReconnect() {
  while (!mqttClient.connected()) {
    if (mqttClient.connect("smartcampus-room-client")) break;
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

void taskMQTT(void* /*pvParams*/) {
 // esp_task_wdt_add(NULL);

  const TickType_t PUB_INTERVAL = pdMS_TO_TICKS(1000);
  TickType_t       lastPub      = xTaskGetTickCount();

  while (true) {
   // esp_task_wdt_reset();

    if (!mqttClient.connected()) mqttReconnect();
    mqttClient.loop();

    if ((xTaskGetTickCount() - lastPub) >= PUB_INTERVAL) {
      lastPub = xTaskGetTickCount();

      // Ambil snapshot aman
      RoomData snap;
      bool     hasData = false;
      if (xSemaphoreTake(xDataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        snap    = g_room;
        hasData = g_room.valid;
        xSemaphoreGive(xDataMutex);
      }

      if (!hasData) {
        vTaskDelay(pdMS_TO_TICKS(10));
        continue;
      }

      const char* gasStatus   = (snap.gas   > 60) ? "HIGH"   : "NORMAL";
      const char* lightStatus = (snap.light < 30) ? "DARK"   : (snap.light > 75 ? "BRIGHT" : "OK");
      const char* noiseStatus = (snap.noise > 70) ? "NOISY"  : "OK";

      char payload[320];
      snprintf(payload, sizeof(payload),
        "{"
          "\"temp\":%.2f,"
          "\"humidity\":%.2f,"
          "\"gas\":%d,\"gas_status\":\"%s\","
          "\"light\":%d,\"light_status\":\"%s\","
          "\"noise\":%d,\"noise_status\":\"%s\","
          "\"fusion_score\":%.2f,"
          "\"critical_cut\":%s,"
          "\"relay\":\"%s\""
        "}",
        snap.temp, snap.hum,
        snap.gas,   gasStatus,
        snap.light, lightStatus,
        snap.noise, noiseStatus,
        snap.fusionScore,
        snap.criticalCut ? "true" : "false",
        snap.relayState  ? "ON"   : "OFF"
      );

      mqttClient.publish(topicRoom, payload);
      Serial.println(payload);
    }

    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// ── WiFi ─────────────────────────────────────────────────────────────────────
static void setup_wifi() {
  WiFi.begin(ssid, password, 6);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

// ── Setup & Loop ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);

  dht.begin();
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);   // relay ON saat boot (aman default)

  setup_wifi();
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setBufferSize(512);

  // Watchdog: panic reset jika salah satu task hang > WDT_TIMEOUT_SEC
 // esp_task_wdt_init(WDT_TIMEOUT_SEC, true);

  xDataMutex = xSemaphoreCreateMutex();
  configASSERT(xDataMutex);

  // Core 1: sensor (prioritas lebih tinggi agar pembacaan tepat waktu)
  xTaskCreatePinnedToCore(taskSensor, "SensorTask", 4096, NULL, 2, NULL, 1);
  // Core 0: MQTT (sama core dengan WiFi stack bawaan ESP-IDF)
  xTaskCreatePinnedToCore(taskMQTT,   "MQTTTask",   8192, NULL, 1, NULL, 0);

  Serial.println("=== ESP RUANGAN STARTED (RTOS + WDT) ===");
}

void loop() {
  // Semua logika di task; loop hanya tidur.
  vTaskDelay(portMAX_DELAY);
}
