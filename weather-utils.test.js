// Tests for the pure weather helpers. Run with: node --test
// No dependencies — uses Node's built-in test runner and assert module.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { weatherIcon, isRainyCode, tempClass } = require("./weather-utils.js");

test("weatherIcon maps clear/cloud codes", () => {
  assert.deepEqual(weatherIcon(0), { icon: "☀️", label: "Clear" });
  assert.deepEqual(weatherIcon(1), { icon: "🌤️", label: "Mainly clear" });
  assert.deepEqual(weatherIcon(2), { icon: "⛅", label: "Partly cloudy" });
  assert.deepEqual(weatherIcon(3), { icon: "☁️", label: "Overcast" });
});

test("weatherIcon maps fog codes", () => {
  assert.equal(weatherIcon(45).label, "Fog");
  assert.equal(weatherIcon(48).label, "Fog");
});

test("weatherIcon maps wet codes to the right labels", () => {
  assert.equal(weatherIcon(51).label, "Drizzle");
  assert.equal(weatherIcon(57).label, "Drizzle");
  assert.equal(weatherIcon(61).label, "Rain");
  assert.equal(weatherIcon(67).label, "Rain");
  assert.equal(weatherIcon(80).label, "Showers");
  assert.equal(weatherIcon(82).label, "Showers");
});

test("weatherIcon maps snow codes", () => {
  assert.equal(weatherIcon(71).label, "Snow");
  assert.equal(weatherIcon(77).label, "Snow");
  assert.equal(weatherIcon(85).label, "Snow showers");
  assert.equal(weatherIcon(86).label, "Snow showers");
});

test("weatherIcon maps thunderstorm codes", () => {
  assert.equal(weatherIcon(95).label, "Thunderstorm");
  assert.equal(weatherIcon(96).label, "Thunderstorm");
  assert.equal(weatherIcon(99).label, "Thunderstorm");
});

test("weatherIcon falls back for unknown codes", () => {
  assert.deepEqual(weatherIcon(1234), { icon: "🌡️", label: "" });
});

test("isRainyCode is true for drizzle/rain (51–67)", () => {
  assert.equal(isRainyCode(51), true);
  assert.equal(isRainyCode(60), true);
  assert.equal(isRainyCode(67), true);
});

test("isRainyCode is true for showers (80–82) and thunder (95+)", () => {
  assert.equal(isRainyCode(80), true);
  assert.equal(isRainyCode(82), true);
  assert.equal(isRainyCode(95), true);
  assert.equal(isRainyCode(99), true);
});

test("isRainyCode is false for dry codes", () => {
  assert.equal(isRainyCode(0), false);
  assert.equal(isRainyCode(3), false);
  assert.equal(isRainyCode(48), false);
  assert.equal(isRainyCode(71), false); // snow is not "rainy"
  assert.equal(isRainyCode(79), false); // boundary just below showers
  assert.equal(isRainyCode(83), false); // boundary just above showers
});

test("tempClass buckets by the day's high", () => {
  assert.equal(tempClass(30), "wx-hot");   // > 28
  assert.equal(tempClass(28.1), "wx-hot");
  assert.equal(tempClass(28), "wx-warm");  // 25–28
  assert.equal(tempClass(25), "wx-warm");
  assert.equal(tempClass(24.9), "wx-mild"); // 20–25
  assert.equal(tempClass(20), "wx-mild");
  assert.equal(tempClass(19.9), "wx-cool"); // < 20
  assert.equal(tempClass(10), "wx-cool");
});
