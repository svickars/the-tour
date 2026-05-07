export type SuggestedPlace = {
	id: string;
	name: string;
	descriptor: string;
	lat: number;
	lng: number;
	/**
	 * Optional hero image: path under `public/` (no leading slash), e.g.
	 * `suggested-places/times-square.jpg`. Served at `/suggested-places/times-square.jpg`.
	 * Omit until the file exists — otherwise the card shows initials only (no failed fetch).
	 */
	coverSrc?: string;
};

/**
 * Curated stops for “Or visit…”. Coordinates are approximate centroids.
 *
 * Hero images: `public/suggested-places/<id>.jpg` (same `id` as each row). After adding
 * or replacing large originals, run `pnpm compress:suggested-places` to resize and
 * recompress for the web.
 */
const PLACES_WITHOUT_COVER_FILE = new Set<string>([]);

const SUGGESTED_PLACES_CORE: Omit<SuggestedPlace, 'coverSrc'>[] = [
	{
		id: 'times-square',
		name: 'Times Square',
		descriptor: 'New York',
		lat: 40.758,
		lng: -73.9855,
	},
	{
		id: 'granville-island',
		name: 'Granville Island',
		descriptor: 'Vancouver',
		lat: 49.2713,
		lng: -123.1343,
	},
	{
		id: 'colosseum',
		name: 'The Colosseum',
		descriptor: 'Rome',
		lat: 41.8902,
		lng: 12.4922,
	},
	{
		id: 'shibuya',
		name: 'Shibuya Crossing',
		descriptor: 'Tokyo',
		lat: 35.6595,
		lng: 139.7004,
	},
	{
		id: 'borough-market',
		name: 'Borough Market',
		descriptor: 'London',
		lat: 51.5055,
		lng: -0.0909,
	},
	{
		id: 'boqueria',
		name: 'La Boqueria',
		descriptor: 'Barcelona',
		lat: 41.3818,
		lng: 2.1719,
	},
	{
		id: 'french-quarter',
		name: 'The French Quarter',
		descriptor: 'New Orleans',
		lat: 29.9584,
		lng: -90.0644,
	},
	{
		id: 'montmartre',
		name: 'Montmartre',
		descriptor: 'Paris',
		lat: 48.8867,
		lng: 2.3431,
	},
	{
		id: 'haight',
		name: 'Haight-Ashbury',
		descriptor: 'San Francisco',
		lat: 37.7694,
		lng: -122.4471,
	},
	{
		id: 'gamla-stan',
		name: 'Gamla Stan',
		descriptor: 'Stockholm',
		lat: 59.3251,
		lng: 18.0718,
	},
	{
		id: 'deira-spice',
		name: 'Deira Spice Souk',
		descriptor: 'Dubai',
		lat: 25.2691,
		lng: 55.2962,
	},
	{
		id: 'petit-champlain',
		name: 'Quartier Petit Champlain',
		descriptor: 'Quebec City',
		lat: 46.8123,
		lng: -71.2055,
	},
	{
		id: 'fitzroy',
		name: 'Fitzroy',
		descriptor: 'Melbourne',
		lat: -37.801,
		lng: 144.979,
	},
	{
		id: 'caminito',
		name: 'Caminito',
		descriptor: 'Buenos Aires',
		lat: -34.6393,
		lng: -58.3625,
	},
	{
		id: 'fez-medina',
		name: 'Medina of Fez',
		descriptor: 'Morocco',
		lat: 34.0625,
		lng: -4.9857,
	},
	{
		id: 'innere-stadt',
		name: 'Innere Stadt',
		descriptor: 'Vienna',
		lat: 48.2082,
		lng: 16.3738,
	},
	{
		id: 'nakameguro',
		name: 'Nakameguro',
		descriptor: 'Tokyo',
		lat: 35.6442,
		lng: 139.6983,
	},
	{
		id: 'notting-hill',
		name: 'Notting Hill',
		descriptor: 'London',
		lat: 51.5095,
		lng: -0.196,
	},
	{
		id: 'pike-place',
		name: 'Pike Place Market',
		descriptor: 'Seattle',
		lat: 47.6097,
		lng: -122.3425,
	},
	{
		id: 'trastevere',
		name: 'Trastevere',
		descriptor: 'Rome',
		lat: 41.8875,
		lng: 12.4695,
	},
];

export const SUGGESTED_PLACES_POOL: SuggestedPlace[] = SUGGESTED_PLACES_CORE.map((p) => ({
	...p,
	...(PLACES_WITHOUT_COVER_FILE.has(p.id) ? {} : { coverSrc: `suggested-places/${p.id}.jpg` }),
}));

/** Build URL for a file in `public/` (Vite serves `public/` at site root). */
export function publicAssetUrl(pathFromPublic: string): string {
	const rel = pathFromPublic.replace(/^\//, '');
	const base = import.meta.env.BASE_URL;
	if (base === '/') return `/${rel}`;
	return `${base.replace(/\/$/, '')}/${rel}`;
}

function mulberry32(seed: number) {
	return function () {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Deterministic 8-place slice for stable SSR-ish grids; pass a new seed to reshuffle. */
export function pickSuggestedPlaces(pool: SuggestedPlace[], seed: number): SuggestedPlace[] {
	const rng = mulberry32(seed >>> 0);
	const idx = pool.map((_, i) => i);
	for (let i = idx.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[idx[i], idx[j]] = [idx[j], idx[i]];
	}
	return idx.slice(0, 8).map((i) => pool[i]!);
}

export function pickRandomPlace(pool: SuggestedPlace[]): SuggestedPlace {
	const i = Math.floor(Math.random() * pool.length);
	return pool[i]!;
}
