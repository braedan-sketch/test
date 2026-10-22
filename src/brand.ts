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
    body: 'A shelter is a pause in the weather. We study the moment it lets go.',
  },
  hero: {
    id: 'field',
    index: '01',
    label: 'Field',
    kicker: 'Cold form',
    title: 'Held together.',
    body: 'A structure drawn in frost. Scroll and it comes apart.',
    hint: 'Scroll',
  },
  burst: {
    id: 'release',
    index: '02',
    label: 'Release',
    kicker: 'Course by course',
    title: 'Crown first.',
    body: 'The top lifts. Each row beneath follows, tumbling clear of a bright core.',
  },
  lattice: {
    id: 'lattice',
    index: '03',
    label: 'Lattice',
    kicker: 'After the shelter',
    title: 'Open lattice.',
    body: 'Rings, loose arcs, and one clear block. The pattern without the walls.',
  },
  note: {
    id: 'note',
    index: '04',
    label: 'Note',
    kicker: 'Manifesto',
    title: 'Make it feel built.',
    body: 'Blendy is a placeholder for work that wants weight, weather, and a clean edge. Swap the name in one file. The rest of the study stays.',
    contact: 'Start a conversation',
  },
  hud: ['CRN-05', 'SLB-04', 'CRS-03', 'BLK-02', 'LNT-01', 'ENTRY'],
  soundOn: 'Sound: On',
  soundOff: 'Sound: Off',
} as const

export type ScreenId = 'field' | 'release' | 'lattice' | 'note'

export const screens = [brand.hero, brand.burst, brand.lattice, brand.note] as const
