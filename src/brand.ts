/**
 * Placeholder brand. Every visible string on the site is read from here.
 * Rename the studio by editing this file only.
 */
export const brand = {
  name: 'BLENDY',
  legal: 'Blendy Studio',
  year: '2026',
  email: 'hello@blendy.studio',
  study: 'Field study / 01',
  description: 'A scroll-driven study in ice, light, and release.',
  loader: {
    status: 'Assembling the field',
    error: 'The field failed to load.',
  },
  corner: {
    kicker: '////// Field note',
    body: 'A shelter is a pause in the weather. Scroll, and the courses let go.',
  },
  hero: {
    id: 'field',
    index: '01',
    label: 'Field',
    kicker: 'Cold form',
    title: 'Held in frost.',
    body: 'Drawn first as wire. Then ice. Then the courses leave the centre.',
    hint: 'Scroll',
  },
  rift: {
    id: 'rift',
    index: '02',
    label: 'Rift',
    kicker: 'Between forms',
    title: 'Through.',
    body: 'A ripple carries the field into the next mass.',
  },
  meteor: {
    id: 'meteor',
    index: '03',
    label: 'Mass',
    kicker: 'Loose ice',
    title: 'One mass.',
    body: 'A jagged crystal, lit from inside. The view goes straight through.',
  },
  rings: {
    id: 'rings',
    index: '04',
    label: 'Rings',
    kicker: 'Courses',
    title: 'Three rings.',
    body: 'Frosted bands turning around a white core.',
  },
  figure: {
    id: 'figure',
    index: '05',
    label: 'Witness',
    kicker: 'After image',
    title: 'The witness.',
    body: 'An arctic fox, held in points above a ring. Then the sand lifts.',
    contact: 'Write to the studio',
  },
  hud: ['21', '22', '23', '24', '28', '19'],
  meteorHud: ['MASS  2.41', 'CORE  0.08', 'RIM  11.6', 'FACE  4.02'],
  links: [
    { label: 'Field desk', value: 'hello@blendy.studio' },
    { label: 'Archive', value: 'North shelf' },
    { label: 'Signal', value: '64.2 N' },
    { label: 'Studio', value: 'Blendy' },
  ],
  soundOn: 'Sound: On',
  soundOff: 'Sound: Off',
} as const

export type ScreenId = 'field' | 'rift' | 'meteor' | 'rings' | 'figure'

export const screens = [brand.hero, brand.rift, brand.meteor, brand.rings, brand.figure] as const
