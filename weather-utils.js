// Pure weather helpers, shared by the app and its tests.
//
// This file has no browser dependencies, so it works both as a <script> tag
// (attaching to window.WeatherUtils) and under Node's test runner (via
// module.exports). Keep everything here side-effect free and DOM-free.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // Node (tests)
  } else {
    root.WeatherUtils = api; // Browser (app.js reads window.WeatherUtils)
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Map a WMO weather code to a friendly emoji + short label.
  function weatherIcon(code) {
    if (code === 0) return { icon: "☀️", label: "Clear" };
    if (code === 1) return { icon: "🌤️", label: "Mainly clear" };
    if (code === 2) return { icon: "⛅", label: "Partly cloudy" };
    if (code === 3) return { icon: "☁️", label: "Overcast" };
    if (code === 45 || code === 48) return { icon: "🌫️", label: "Fog" };
    if (code >= 51 && code <= 57) return { icon: "🌦️", label: "Drizzle" };
    if (code >= 61 && code <= 67) return { icon: "🌧️", label: "Rain" };
    if (code >= 71 && code <= 77) return { icon: "🌨️", label: "Snow" };
    if (code >= 80 && code <= 82) return { icon: "🌦️", label: "Showers" };
    if (code === 85 || code === 86) return { icon: "🌨️", label: "Snow showers" };
    if (code === 95) return { icon: "⛈️", label: "Thunderstorm" };
    if (code === 96 || code === 99) return { icon: "⛈️", label: "Thunderstorm" };
    return { icon: "🌡️", label: "" };
  }

  // Codes that mean "wet" — used to flag rainy days at a glance.
  function isRainyCode(code) {
    return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  }

  // Temperature band -> badge colour class (based on the day's high).
  function tempClass(max) {
    if (max > 28) return "wx-hot";      // above 28° — red
    if (max >= 25) return "wx-warm";    // 25–28° — orange
    if (max >= 20) return "wx-mild";    // 20–25° — yellow
    return "wx-cool";                   // below 20° — cool blue
  }

  return { weatherIcon: weatherIcon, isRainyCode: isRainyCode, tempClass: tempClass };
});
