#include <Arduino.h>

constexpr char kOwner[] = "friend";
constexpr uint32_t kBlinkHalfPeriodMs = 500;

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);

  delay(500);
  Serial.println();
  Serial.print("Hello, ");
  Serial.print(kOwner);
  Serial.println("! This entire application was compiled locally in Wanix.");
}

void loop() {
  // The D1 mini Pro's built-in LED is active-low.
  digitalWrite(LED_BUILTIN, LOW);
  delay(kBlinkHalfPeriodMs);
  digitalWrite(LED_BUILTIN, HIGH);
  delay(kBlinkHalfPeriodMs);
}
