/**
 * One line-art icon set, drawn on a 24×24 grid with a consistent 1.5 stroke.
 *
 * The previous page used emoji as iconography. Emoji render differently on every
 * platform, carry their own colour, and are read aloud by screen readers as their
 * Unicode name, so "🅿️ Parcheggio" was announced as "negative squared latin
 * capital letter P, Parcheggio". These are inert SVG with aria-hidden, and the
 * text beside them does the talking.
 */

const paths = {
  // Arrival
  key:        'M8.5 19.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM11.2 13.2 20 4.4M16.8 7.6l2.6 2.6M14.2 10.2l2.6 2.6',
  door:       'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16M14 12h.01',
  moon:       'M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5Z',
  suitcase:   'M4 8h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M9 19v1M15 19v1',
  car:        'M3 13.2h18M4.8 13.2 6.6 8.1A2 2 0 0 1 8.5 6.7h7A2 2 0 0 1 17.4 8l1.8 5.1M3 13.2v3.3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3.3M7 17.5v1.6M17 17.5v1.6',
  camera:     'M4 8h3l1.4-2h7.2L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z M12 16.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
  train:      'M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM5 10h14M8.5 13.5h.01M15.5 13.5h.01M8 17l-2 3M16 17l2 3',
  plane:      'M10.5 20.5 12 15l7.5-2.2a1.8 1.8 0 0 0-.9-3.5L12 11 9 4.5 7 5l1.6 7-4 1.1-1.6-2-1.4.4 1.6 4.4L7 14.8l1.4 5.3Z',
  receipt:    'M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.4ZM9 8h6M9 12h6M9 16h3',

  // Stay
  home:       'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1ZM9.5 21v-6h5v6',
  wifi:       'M2.5 9a15 15 0 0 1 19 0M6 12.5a10 10 0 0 1 12 0M9.5 16a5 5 0 0 1 5 0M12 19.5h.01',
  thermometer:'M12 14.8V5a2 2 0 1 1 4 0v9.8a4.5 4.5 0 1 1-4 0Z M14 18.5h.01',
  towel:      'M7 4h11a2 2 0 0 1 2 2v14H9a2 2 0 0 1-2-2ZM7 4a2 2 0 0 0-2 2v2h2M11 9h5M11 13h5',
  glass:      'M8 3h8l-1 7a3 3 0 0 1-6 0ZM12 13v6M9 20h6',
  broom:      'M14 3 9.5 11M5 21l3.5-7 7 3.5L12 21ZM8 14l6 3',
  accessibility: 'M12 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 10h8M12 10v5M12 15l-2.5 5M12 15l2.5 5',
  ear:        'M8 9a4 4 0 1 1 8 0c0 2.5-2.5 3-2.5 5a2.2 2.2 0 0 1-4.3.5M8.5 19.5a3 3 0 0 1-2-2.8V9',
  'no-smoking':'M4 13h12a2 2 0 0 1 2 2v2H4ZM17 8c1.5 0 2.5 1 2.5 2.5M4 4l16 16',
  paw:        'M7 11.5a1.8 1.8 0 1 0 0-3.5 1.8 1.8 0 0 0 0 3.5ZM17 11.5a1.8 1.8 0 1 0 0-3.5 1.8 1.8 0 0 0 0 3.5ZM10 8a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 10 8ZM14 8a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 14 8ZM12 12.5c2.8 0 4.5 2 4.5 4a2.7 2.7 0 0 1-3.8 2.4 2 2 0 0 0-1.4 0A2.7 2.7 0 0 1 7.5 16.5c0-2 1.7-4 4.5-4Z',
  drop:       'M12 3.5c3 4 5.5 6.6 5.5 9.6a5.5 5.5 0 0 1-11 0c0-3 2.5-5.6 5.5-9.6Z',
  child:      'M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 11.5A4 4 0 0 1 12 9a4 4 0 0 1 4 2.5M9 21v-5H8v-3M15 21v-5h1v-3',

  // Breakfast
  cup:        'M4 8h12v5a5 5 0 0 1-10 0ZM16 9.5h2a2.5 2.5 0 0 1 0 5h-2M4 20h14',
  espresso:   'M6 10h9v3.5a4.5 4.5 0 0 1-9 0ZM15 11h1.5a2 2 0 0 1 0 4H15M8 6.5V5M11 6.5V5M5 19h12',
  gift:       'M3.5 10h17v3h-17ZM5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7M12 10v11M12 10S10.5 5 8 5a2 2 0 0 0 0 5M12 10s1.5-5 4-5a2 2 0 0 1 0 5',
  tray:       'M3 17h18M5 17a7 7 0 0 1 14 0M12 10V7M10.5 7h3M7 20h10',
  sunrise:    'M12 4v3M5.5 9.5 7.5 11M18.5 9.5 16.5 11M3 17h18M7 17a5 5 0 0 1 10 0M6 21h12',
  leaf:       'M20 4c0 9-5 13-11 13a5 5 0 0 1 0-10c4 0 6-1 7-3M4 21c1.5-4.5 4-7 8-9',

  // Help
  chat:       'M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  lifebuoy:   'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9',
  wrench:     'M15.5 4.5a4.5 4.5 0 0 0-5.3 5.9L4 16.6 7.4 20l6.2-6.2a4.5 4.5 0 0 0 5.9-5.3L16.8 11 13 7.2Z',
  alert:      'M12 3.5 21 19H3ZM12 10v4M12 17h.01',
  card:       'M3 7h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1ZM2 11h20M6 15h3',
  clock:      'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2',

  // Departure and city
  taxi:       'M3 13.2h18M4.8 13.2 6.6 8.1A2 2 0 0 1 8.5 6.7h7A2 2 0 0 1 17.4 8l1.8 5.1M3 13.2v3.3a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3.3M7 17.5v1.6M17 17.5v1.6M9.3 6.7V4.4h5.4v2.3',
  compass:    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15.5 8.5l-2 5-5 2 2-5Z',
  fork:       'M7 3v6a2 2 0 0 0 4 0V3M9 11v10M16 3c-1.5 1.5-2 3-2 5.5 0 1.5.8 2.5 2 2.5V3ZM16 11v10',
  wine:       'M8 3h8l-.5 5a3.5 3.5 0 0 1-7 0ZM12 11.5V18M8.5 18h7',
  icecream:   'M8 9a4 4 0 1 1 8 0ZM8 9h8l-4 11Z',
  museum:     'M3 9.5 12 4l9 5.5M4.5 9.5V18M9.5 9.5V18M14.5 9.5V18M19.5 9.5V18M3 21h18M3 18h18',
  hills:      'M3 18h18M3 18l5.5-7 3.5 4 3-4 6 7M8.5 11 7 9M12 15l-1.5-2',
  walk:       'M13.5 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM11 21l2-6-2.5-2.5V9l3-1.5 2 3 2.5 1M10.5 12.5 8 15l-1 6',
  spa:        'M12 20c0-5 2.5-8.5 7-10-1 5-3.5 8-7 10ZM12 20c0-5-2.5-8.5-7-10 1 5 3.5 8 7 10ZM12 20v-5',
  steak:      'M5.5 8.5C7 5.5 10 4 13.5 4 17.6 4 20 6.4 20 9.5c0 4.5-3.8 10.5-9 10.5-3.5 0-6.5-2.3-6.5-5.5 0-2.4 1-4.4 1-6ZM10 10.5c1.5-1 3-1 4.5 0',
  pasta:      'M5 5h14M5 9h14M6 13h12a0 0 0 0 1 0 0 6 6 0 0 1-12 0ZM9 19h6',
  candle:     'M9.5 10h5v10h-5ZM12 10V7.5M12 7.5c0-1.5-1.5-1.8-1.5-3C10.5 3.3 12 2.5 12 2.5s1.5.8 1.5 2c0 1.2-1.5 1.5-1.5 3ZM7 20h10',

  // Interface
  search:     'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16.2 16.2 21 21',
  close:      'M6 6l12 12M18 6 6 18',
  chevron:    'M9 5l7 7-7 7',
  copy:       'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1ZM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  check:      'M4.5 12.5 9.5 18 20 6.5',
  send:       'M4 12 20 4l-8 16-2-6Z',
  external:   'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  phone:      'M6.5 3.5 9 4l1.5 4L8.5 9.5a11 11 0 0 0 6 6L16 13.5l4 1.5.5 2.5a2 2 0 0 1-2.2 2.3C10.6 19 5 13.4 4.2 5.7A2 2 0 0 1 6.5 3.5Z',
  map:        'M9 4 3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5ZM9 4v14M15 6.5v14',
  mail:       'M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM2.5 7l9.5 7 9.5-7',
  dot:        'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
};

/** Icon ids a data file may refer to. */
export const ICON_IDS = Object.keys(paths);

/**
 * Render one icon as an inert SVG string.
 * Always decorative: callers put the meaning in the adjacent text.
 */
export function icon(id, size = 20) {
  const d = paths[id] ?? paths.dot;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}
