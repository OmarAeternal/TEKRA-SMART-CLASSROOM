#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <math.h>

// WiFi / MQTT
const char* ssid        = "Wokwi-GUEST";
const char* password    = "";
const char* mqtt_server = "broker.hivemq.com";
const int   mqtt_port   = 1883;

const char* topicRoom        = "smartcampus/demo1/room";
const char* topicSeatPrefix  = "smartcampus/demo1/seat/";
const char* topicSeatSub     = "smartcampus/demo1/seat/#";
const char* topicSummary     = "smartcampus/demo1/summary";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

// Relay / comfort thresholds
static const int   SCORE_ON_THR  = 62;
static const int   SCORE_OFF_THR = 48;
static const int   GAS_CRITICAL  = 65;
static const float TEMP_CRITICAL = 33.0f;

// Room state
static float g_temp       = 27.0f;
static float g_hum        = 62.0f;
static int   g_gas        = 35;
static int   g_light      = 58;
static int   g_noise      = 41;
static float g_fusionRoom = 0.0f;
static bool  g_roomRelay  = true;
static bool  g_critCut    = false;

// Seat state
struct SeatState {
  char  id[16];
  float weight;
  bool  occupied;
};

static SeatState seats[8];
static uint8_t seatCount = 0;
static bool g_motion = false;

// Hysteresis state
static bool g_suggestedRelay = true;

unsigned long lastSend = 0;

static int comfortScore() {
  int score = 100;

  if (g_temp < 22.0f || g_temp > 28.0f) score -= 20;
  else if (g_temp < 24.0f || g_temp > 27.0f) score -= 8;

  if (g_hum < 40.0f || g_hum > 75.0f) score -= 15;

  if      (g_gas > 60) score -= 25;
  else if (g_gas > 40) score -= 10;

  if (g_light < 30 || g_light > 80) score -= 10;

  if      (g_noise > 70) score -= 15;
  else if (g_noise > 55) score -= 5;

  if (g_motion) score -= 3;

  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}

static bool decideSuggestedRelay(int score) {
  bool critical = (g_gas >= GAS_CRITICAL) || (g_temp >= TEMP_CRITICAL);

  if (critical) {
    g_suggestedRelay = false;
    return false;
  }

  if (g_suggestedRelay && score < SCORE_OFF_THR) g_suggestedRelay = false;
  if (!g_suggestedRelay && score > SCORE_ON_THR) g_suggestedRelay = true;

  return g_suggestedRelay;
}

static int findSeatIndex(const char* id) {
  for (uint8_t i = 0; i < seatCount; i++) {
    if (strcmp(seats[i].id, id) == 0) return i;
  }
  return -1;
}

static void upsertSeat(const char* id, bool occupied, float weight) {
  int idx = findSeatIndex(id);

  if (idx < 0) {
    if (seatCount >= 8) return;
    idx = seatCount++;
    strncpy(seats[idx].id, id, sizeof(seats[idx].id) - 1);
    seats[idx].id[sizeof(seats[idx].id) - 1] = '\0';
  }

  seats[idx].occupied = occupied;
  seats[idx].weight = weight;
}

static void setup_wifi() {
  WiFi.begin(ssid, password, 6);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

static void reconnect() {
  while (!mqttClient.connected()) {
    String clientId = "gateway-" + String(random(0xffff), HEX);

    if (mqttClient.connect(clientId.c_str())) {
      mqttClient.subscribe(topicRoom);
      mqttClient.subscribe(topicSeatSub);
    } else {
      delay(2000);
    }
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.print("JSON parse error: ");
    Serial.println(err.c_str());
    return;
  }

  if (strcmp(topic, topicRoom) == 0) {
    g_temp       = doc["temp"]         | g_temp;
    g_hum        = doc["humidity"]     | g_hum;
    g_gas        = doc["gas"]          | g_gas;
    g_light      = doc["light"]        | g_light;
    g_noise      = doc["noise"]        | g_noise;
    g_fusionRoom = doc["fusion_score"] | g_fusionRoom;
    g_critCut    = doc["critical_cut"] | g_critCut;

    const char* rel = doc["relay"] | "ON";
    g_roomRelay = (strcmp(rel, "ON") == 0);
    return;
  }

  if (strncmp(topic, topicSeatPrefix, strlen(topicSeatPrefix)) == 0) {
    const char* id = doc["id"] | "seat_x";
    bool occupied  = doc["occupied"] | false;
    float weight   = doc["weight"] | 0.0f;

    upsertSeat(id, occupied, weight);

    if (doc.containsKey("motion")) {
      g_motion = doc["motion"] | g_motion;
    }
  }
}

void setup() {
  Serial.begin(115200);
  randomSeed(micros());

  setup_wifi();
  mqttClient.setServer(mqtt_server, mqtt_port);
  mqttClient.setCallback(callback);
  mqttClient.setBufferSize(2048);

  Serial.println("=== ESP GATEWAY STARTED ===");
}

void loop() {
  if (!mqttClient.connected()) reconnect();
  mqttClient.loop();

  if (millis() - lastSend >= 2000) {
    lastSend = millis();

    int score = comfortScore();
    bool sugRelay = decideSuggestedRelay(score);

    StaticJsonDocument<1024> out;
    out["temp"] = g_temp;
    out["humidity"] = g_hum;
    out["gas"] = g_gas;
    out["light"] = g_light;
    out["noise"] = g_noise;
    out["motion"] = g_motion;
    out["room_relay"] = g_roomRelay ? "ON" : "OFF";
    out["room_fusion"] = g_fusionRoom;
    out["critical_cut"] = g_critCut;
    out["comfort_score"] = score;
    out["suggested_relay"] = sugRelay ? "ON" : "OFF";

    JsonArray arr = out.createNestedArray("seats");
    for (uint8_t i = 0; i < seatCount; i++) {
      JsonObject s = arr.createNestedObject();
      s["id"] = seats[i].id;
      s["occupied"] = seats[i].occupied;
      s["weight"] = seats[i].weight;
    }

    char summary[1024];
    size_t n = serializeJson(out, summary, sizeof(summary));
    if (n > 0) {
      mqttClient.publish(topicSummary, summary);
      Serial.println(summary);
    }
  }
}