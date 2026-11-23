import type { Offer } from '@prisma/client';

const EARTH_RADIUS_KM = 6371;
// Pénalité de score par annulation vendeur : 1 annulation coûte plus qu'un
// écart de ~1 km en proximité, sans faire basculer un vendeur propre.
const CANCELLATION_PENALTY = 0.5;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Distance de Haversine exacte entre deux points GPS, en km. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** % de solde arrondi, null si pas de prix d'origine exploitable. */
export function discountPercentage(
  offer: Pick<Offer, 'price' | 'originalPrice'>,
): number | null {
  if (offer.originalPrice == null || offer.originalPrice <= 0) {
    return null;
  }
  return Math.round(((offer.originalPrice - offer.price) / offer.originalPrice) * 100);
}

export interface ScoreableOffer {
  expirationDate: Date;
  distanceKm?: number;
  creator: { creatorCancellationCount: number };
}

/** Score combiné : proximité (si coords), DLC proche, moins les annulations vendeur. */
export function defaultScore(
  offer: ScoreableOffer,
  lat: number | undefined,
  lng: number | undefined,
  now: Date,
): number {
  const proximity =
    lat != null && lng != null && offer.distanceKm != null
      ? 1 / (1 + offer.distanceKm)
      : 0;
  const hoursLeft = Math.max(
    0,
    (offer.expirationDate.getTime() - now.getTime()) / 3_600_000,
  );
  const dlc = 1 / (1 + hoursLeft);
  return proximity + dlc - offer.creator.creatorCancellationCount * CANCELLATION_PENALTY;
}

export function sortOffers<T extends ScoreableOffer>(
  offers: T[],
  sortBy: 'default' | 'distance' | 'dlc',
  lat: number | undefined,
  lng: number | undefined,
  now: Date,
): T[] {
  switch (sortBy) {
    case 'distance':
      return [...offers].sort(
        (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
      );
    case 'dlc':
      return [...offers].sort(
        (a, b) => a.expirationDate.getTime() - b.expirationDate.getTime(),
      );
    default:
      return [...offers].sort(
        (a, b) => defaultScore(b, lat, lng, now) - defaultScore(a, lat, lng, now),
      );
  }
}
