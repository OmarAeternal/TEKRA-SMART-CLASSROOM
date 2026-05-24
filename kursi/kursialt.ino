#include <WiFi.h>
#include <PubSubClient.h>
#include "HX711.h"

// KONFIGURASI KURSI 
#define SEAT_NUMBER 2  // <--- GANTI ANGKA INI UNTUK KURSI YANG BERBEDA (Misal: 2, 3, 4, dst)

// Pin config 
#define HX711_DOUT    4
#define HX711_SCK     5

// WiFi / MQTT 
const char* ssid        = "Wokwi-GUEST";
const char* password    = "";
const char* mqtt_server = "broker.hivemq.com";
const int   mqtt_port   = 1883;

// String dinamis untuk MQTT
char clientId[32];
char topicSeat[64];
char seatIdStr[16];

WiFiClient   espClient;
PubSubClient mqttClient(espClient);
HX711        scale;

// Kalibrasi & threshold 
static const float CALIBRATION_FACTOR = 420.0f;
static const float OCCUPIED_MIN_KG    = 3.0f;
static const int   HX711_AVG_SAMPLES  = 1;

// Shared data (mutex-protected) 
SemaphoreHandle_t xDataMutex;

struct SeatData {
  float weight   = 0.0f;
  bool  occupied = false;
};

static SeatData g_seat;

// TASK SENSOR (Tanpa PIR)
void taskSensor(void* /*pvParams*/) {
  const TickType_t period   = pdMS_TO_TICKS(200);
  TickType_t       lastWake = xTaskGetTickCount();

  while (true) {
    // Membaca HX711
    float weight = 0.0f;
    if (scale.is_ready()) {
      float raw = scale.get_units(HX711_AVG_SAMPLES);
      weight = (raw < 0.0f) ? 0.0f : raw;
    }

    bool occupied = (weight >= OCCUPIED_MIN_KG);

    if (xSemaphoreTake(xDataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      g_seat.weight   = weight;
      g_seat.occupied = occupied;
      xSemaphoreGive(xDataMutex);
    }

    vTaskDelayUntil(&lastWake, period);
  }
}

// MQTT RECONNECT
static void mqttReconnect() {
  while (!mqttClient.connected()) {
    // Menggunakan Client ID yang dinamis agar tidak bentrok antar ESP
    if (mqttClient.connect(clientId)) {
      // Tidak perlu subscribe jika ESP ini hanya bertugas mem-publish (opsional)
      // mqttClient.subscribe(topicSeat); 
      break;
    }
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

// TASK MQTT
void taskMQTT(void* /*pvParams*/) {
  const TickType_t PUB_INTERVAL = pdMS_TO_TICKS(1000);
  TickType_t       lastPub      = xTaskGetTickCount();

  while (true) {
    if (!mqttClient.connected()) {
      mqttReconnect();
    }

    mqttClient.loop();

    if ((xTaskGetTickCount() - lastPub) >= PUB_INTERVAL) {
      lastPub = xTaskGetTickCount();

      SeatData snap;
      if (xSemaphoreTake(xDataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        snap = g_seat;
        xSemaphoreGive(xDataMutex);
      }

      char payload[128];
      snprintf(
        payload,
        sizeof(payload),
        "{"
          "\"id\":\"%s\","
          "\"weight\":%.2f,"
          "\"occupied\":%s"
        "}",
        seatIdStr,
        snap.weight,
        snap.occupied ? "true" : "false"
      );

      mqttClient.publish(topicSeat, payload);
      Serial.println(payload);
    }

    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// WIFI
static void setup_wifi() {
  WiFi.begin(ssid, password, 6);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

// SETUP
void setup() {
  Serial.begin(115200);

  // Generate ID dan Topik berdasarkan SEAT_NUMBER
  snprintf(seatIdStr, sizeof(seatIdStr), "seat_%d", SEAT_NUMBER);
  snprintf(clientId, sizeof(clientId), "smartcampus-seat-%d", SEAT_NUMBER);
  snprintf(topicSeat, sizeof(topicSeat), "smartcampus/demo1/seat/%s", seatIdStr);

  scale.begin(HX711_DOUT, HX711_SCK);
  scale.set_scale(CALIBRATION_FACTOR);
  scale.tare();

  setup_wifi();

  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setBufferSize(512);

  xDataMutex = xSemaphoreCreateMutex();
  configASSERT(xDataMutex);

  xTaskCreatePinnedToCore(
    taskSensor,
    "SensorTask",
    4096,
    NULL,
    2,
    NULL,
    1
  );

  xTaskCreatePinnedToCore(
    taskMQTT,
    "MQTTTask",
    8192,
    NULL,
    1,
    NULL,
    0
  );

  Serial.printf("=== ESP SENSOR UNTUK %s STARTED ===\n", seatIdStr);
  Serial.printf("MQTT Topic: %s\n", topicSeat);
}


void loop() {
  vTaskDelay(portMAX_DELAY);
}