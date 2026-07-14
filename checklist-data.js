/*
 * SUMMER HOLIDAYS CHECKLIST — this is the ONLY file you need to edit to change
 * the content. Add/remove items freely; each is one line.
 *
 * `daily: true`  -> part of the repeatable daily-basics routine (resettable).
 * (no `daily`)   -> a one-off item ticked once over the whole summer.
 * `paid: true`   -> a chores category where each item earns money. In a paid
 *                  category, items are objects: { name: "…", reward: 1.50 }.
 *                  A chore may also add `daily: true` so it resets each morning
 *                  (e.g. "Make your bed"); chores without it are one-off for the
 *                  whole summer (e.g. "Wash the car"). Earned money is banked and
 *                  kept across daily resets.
 *                  Everywhere else, items stay simple strings.
 */

const CHECKLIST = [
  {
    category: "🎯 Daily basics",
    color: "#ffb59e",
    daily: true,
    items: [
      "Read for 20 minutes",
      "Outdoor play / fresh air",
      "Help with a chore",
      "Screen-time check",
      "Creative time (draw / build / craft)",
      "Tidy up toys",
    ],
  },
  {
    category: "🗓️ Activities & days out",
    color: "#a6cdf5",
    items: [
      "Beach or park trip",
      "Natural History Museum",
      "Library visit",
      "Bike ride",
      "Picnic",
      "Museum or gallery",
      "Swimming",
      "Baking together",
      "Movie night",
      "Playdate with friends",
      "Nature walk / scavenger hunt",
      "Ice cream treat",
      "Camping (garden or away)",
    ],
  },
  {
    category: "🌧️ Rainy-day ideas",
    color: "#c3b8f0",
    items: [
      "Board games",
      "Make tea",
      "Build a fort",
      "Arts & crafts",
      "Baking / cooking",
      "Jigsaw puzzle",
      "Lego build challenge",
      "Indoor treasure hunt",
      "Movie & popcorn",
    ],
  },
  {
    category: "🧳 Day-out bag",
    color: "#a3ddc4",
    items: [
      "Water bottles",
      "Sun cream",
      "Sun hats",
      "Snacks",
      "Spare clothes",
      "Wipes & tissues",
      "First-aid basics",
      "Bug spray",
      "Plasters",
      "Change of shoes",
    ],
  },
  {
    category: "📚 Keep learning",
    color: "#f6c88a",
    items: [
      "Summer reading challenge",
      "Times tables practice",
      "Holiday journal / diary",
      "Learn a new skill",
      "Educational app / game",
    ],
  },
  {
    category: "✅ Back-to-school prep",
    color: "#f2aecb",
    items: [
      "New uniform",
      "School shoes",
      "PE kit",
      "Stationery & pencil case",
      "Backpack",
      "Water bottle & lunchbox",
      "Name labels",
      "Haircut",
      "Restart bedtime routine",
      "Check term dates",
    ],
  },
  {
    category: "💰 Chores",
    color: "#b9e3a8",
    paid: true,
    items: [
      { name: "Make your bed", reward: 0.5, daily: true },
      { name: "Tidy your bedroom", reward: 1.0, daily: true },
      { name: "Load / empty the dishwasher", reward: 1.0, daily: true },
      { name: "Take out rubbish & recycling", reward: 0.5, daily: true },
      { name: "Water the plants", reward: 0.5, daily: true },
      { name: "Set the table", reward: 0.5, daily: true },
      { name: "Vacuum a room", reward: 1.5 },
      { name: "Wash the car", reward: 3.0 },
    ],
  },
];
